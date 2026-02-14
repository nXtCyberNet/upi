"""
Batch graph analytics runner – optimised.

Periodically (every GRAPH_ANALYTICS_INTERVAL_SEC):
  1. Runs background user-stats aggregation (moved from hot path)
  2. Refreshes device account counts
  3. Flags dormant accounts
  4. If GDS is available: projection → Louvain → Betweenness → PageRank → CC
     If GDS is unavailable: pure-Cypher approximations for the above
  5. Triggers collusive fraud pattern detection refresh

Heavy algorithms run here so the per-transaction fast-path only reads
pre-computed node properties.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Dict, Optional

from app.neo4j_manager import Neo4jManager
from app.utils import cypher_queries as CQ
from app.detection.collusive_fraud import CollusiveFraudDetector
from app.config import settings

logger = logging.getLogger(__name__)


class GraphAnalyzer:
    """Background task that runs GDS algorithms on a timer."""

    def __init__(
        self,
        neo4j: Neo4jManager,
        collusive_detector: CollusiveFraudDetector,
    ) -> None:
        self.neo4j = neo4j
        self.collusive = collusive_detector
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self.last_run_stats: Dict = {}
        self._gds_available: Optional[bool] = None  # None = not probed yet

    async def _probe_gds(self) -> bool:
        """Check once whether Neo4j GDS plugin is installed."""
        if self._gds_available is not None:
            return self._gds_available
        try:
            res = await self.neo4j.run_async(CQ.GDS_PROBE)
            ver = res[0].get("version", "?") if res else "?"
            logger.info("✅ GDS plugin detected (v%s) – using native algorithms", ver)
            self._gds_available = True
        except Exception:
            logger.warning(
                "⚠️  GDS plugin NOT available – using pure-Cypher fallback "
                "algorithms.  For better performance install GDS via "
                "docker-compose or NEO4J_PLUGINS=[\"graph-data-science\"]"
            )
            self._gds_available = False
        return self._gds_available

    async def start(self) -> None:
        """Launch the periodic loop."""
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info(
            "📊 Graph analyzer started (interval=%ds)",
            settings.GRAPH_ANALYTICS_INTERVAL_SEC,
        )

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Graph analyzer stopped")

    # ── internal loop ────────────────────────────────────────

    async def _loop(self) -> None:
        # initial delay to let some data accumulate
        await asyncio.sleep(3)
        while self._running:
            try:
                stats = await self.run_once()
                self.last_run_stats = stats
            except Exception as exc:  # noqa: BLE001
                logger.error("Graph analytics batch failed: %s", exc)
            await asyncio.sleep(settings.GRAPH_ANALYTICS_INTERVAL_SEC)

    async def run_once(self) -> Dict:
        """Execute a single analytics cycle.  Returns timing dict."""
        t0 = time.perf_counter()
        stats: Dict = {}

        # ── Probe GDS availability on first run ──
        gds = await self._probe_gds()

        # ── Phase 1: Background aggregation (decoupled from hot path) ──
        try:
            res = await self.neo4j.run_async(
                CQ.BATCH_UPDATE_USER_STATS,
                {"window_sec": settings.GRAPH_ANALYTICS_INTERVAL_SEC * 3},
            )
            stats["user_stats_updated"] = res[0].get("users_updated", 0) if res else 0
            logger.info("  User stats aggregated: %d users", stats["user_stats_updated"])
        except Exception as exc:  # noqa: BLE001
            logger.warning("User stats aggregation failed: %s", exc)

        try:
            res = await self.neo4j.run_async(CQ.BATCH_UPDATE_DEVICE_STATS)
            stats["device_stats_updated"] = res[0].get("devices_updated", 0) if res else 0
        except Exception as exc:  # noqa: BLE001
            logger.warning("Device stats update failed: %s", exc)

        # ── Phase 1b: Flag dormant accounts ──
        try:
            res = await self.neo4j.run_async(
                CQ.QUERY_FLAG_DORMANT_ACCOUNTS,
                {"dormant_days": settings.DORMANT_DAYS_THRESHOLD},
            )
            stats["dormant_flagged"] = res[0].get("dormant_count", 0) if res else 0
        except Exception as exc:  # noqa: BLE001
            logger.warning("Dormant flagging failed: %s", exc)

        # ── Phase 2 + 3: Graph algorithms ──
        if gds:
            await self._run_gds_algorithms(stats)
        else:
            await self._run_fallback_algorithms(stats)

        # ── Phase 4: Collusive pattern refresh + relay mule ──
        try:
            detect_counts = await self.collusive.refresh()
            stats["detection"] = detect_counts
        except Exception as exc:  # noqa: BLE001
            logger.warning("Collusive detection refresh failed: %s", exc)

        elapsed = time.perf_counter() - t0
        stats["elapsed_sec"] = round(elapsed, 3)
        logger.info("📊 Graph analytics cycle complete in %.1f s", elapsed)
        return stats

    # ── GDS path ─────────────────────────────────────────────

    async def _run_gds_algorithms(self, stats: Dict) -> None:
        """Run graph algorithms via the GDS plugin."""

        # Drop old projection (ignore if it doesn't exist)
        try:
            await self.neo4j.run_async(CQ.GDS_DROP_PROJECTION)
        except Exception:  # noqa: BLE001
            pass

        # Create fresh projection
        try:
            proj = await self.neo4j.run_async(CQ.GDS_CREATE_PROJECTION)
            if proj:
                stats["projection"] = proj[0]
                logger.info(
                    "  GDS projection: %d nodes, %d rels",
                    proj[0].get("nodeCount", 0),
                    proj[0].get("relationshipCount", 0),
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("GDS projection failed: %s", exc)
            stats["projection_error"] = str(exc)
            # Fallback mid-cycle: GDS licence may have expired
            logger.info("  Falling back to Cypher-only algorithms for this cycle")
            await self._run_fallback_algorithms(stats)
            return

        # Louvain community detection
        try:
            res = await self.neo4j.run_async(CQ.GDS_LOUVAIN)
            if res:
                stats["louvain"] = res[0]
                logger.info("  Louvain: %d communities", res[0].get("communityCount", 0))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Louvain failed: %s", exc)

        # Betweenness centrality
        try:
            res = await self.neo4j.run_async(CQ.GDS_BETWEENNESS)
            if res:
                stats["betweenness"] = res[0]
        except Exception as exc:  # noqa: BLE001
            logger.warning("Betweenness failed: %s", exc)

        # PageRank
        try:
            res = await self.neo4j.run_async(CQ.GDS_PAGERANK)
            if res:
                stats["pagerank"] = res[0]
        except Exception as exc:  # noqa: BLE001
            logger.warning("PageRank failed: %s", exc)

        # Local clustering coefficient
        try:
            res = await self.neo4j.run_async(CQ.GDS_LOCAL_CLUSTERING)
            if res:
                stats["clustering"] = res[0]
        except Exception as exc:  # noqa: BLE001
            logger.warning("Local clustering failed: %s", exc)

    # ── Pure-Cypher fallback path ────────────────────────────

    async def _run_fallback_algorithms(self, stats: Dict) -> None:
        """Run approximate graph algorithms using pure Cypher (no GDS)."""
        stats["mode"] = "cypher-fallback"

        # Community detection (connected-component labelling)
        try:
            res = await self.neo4j.run_async(CQ.FALLBACK_COMMUNITY_DETECTION)
            if res:
                stats["louvain"] = res[0]
                logger.info(
                    "  Fallback communities: %d assigned",
                    res[0].get("communityCount", 0),
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Fallback community detection failed: %s", exc)

        # Betweenness approximation
        try:
            res = await self.neo4j.run_async(CQ.FALLBACK_BETWEENNESS)
            if res:
                stats["betweenness"] = res[0]
                logger.info("  Fallback betweenness: %d nodes", res[0].get("nodePropertiesWritten", 0))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Fallback betweenness failed: %s", exc)

        # PageRank approximation
        try:
            res = await self.neo4j.run_async(CQ.FALLBACK_PAGERANK)
            if res:
                stats["pagerank"] = res[0]
                logger.info("  Fallback pagerank: %d nodes", res[0].get("nodePropertiesWritten", 0))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Fallback pagerank failed: %s", exc)

        # Clustering coefficient approximation
        try:
            res = await self.neo4j.run_async(CQ.FALLBACK_CLUSTERING_COEFF)
            if res:
                stats["clustering"] = res[0]
        except Exception as exc:  # noqa: BLE001
            logger.warning("Fallback clustering coeff failed: %s", exc)

        # Zero out nodes with < 2 neighbours
        try:
            await self.neo4j.run_async(CQ.FALLBACK_CLUSTERING_COEFF_ZERO)
        except Exception:  # noqa: BLE001
            pass
