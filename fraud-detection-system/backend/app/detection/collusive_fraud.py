"""
Collusive fraud detection – optimised with relay mule detection.

Runs pattern-matching Cypher queries against Neo4j to identify:
  • Fraud islands  – Louvain clusters with high internal risk
  • Money routers  – high betweenness-centrality nodes
  • Circular flows – A → B → C → A style laundering
  • Rapid chains   – layered transfers within short windows (depth ≤ 4)
  • Star hubs      – fan-in / fan-out mule hubs
  • Relay mules    – high flow-ratio (outflow/inflow) in 10-min window

Results are cached and refreshed every graph-analytics batch cycle.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Set

from app.neo4j_manager import Neo4jManager
from app.utils import cypher_queries as CQ

logger = logging.getLogger(__name__)


class CollusiveFraudDetector:
    """Detect collusive fraud patterns in the transaction graph."""

    def __init__(self, neo4j: Neo4jManager) -> None:
        self.neo4j = neo4j

        # in-memory caches refreshed by batch cycle
        self.fraud_islands: List[Dict] = []
        self.money_routers: List[Dict] = []
        self.circular_flows: List[Dict] = []
        self.rapid_chains: List[Dict] = []
        self.star_hubs: List[Dict] = []
        self.relay_mules: List[Dict] = []

        # lookup: user_id → set of cluster_ids they belong to
        self._user_clusters: Dict[str, set] = {}
        # lookup: user_id → relay info (for O(1) per-tx)
        self._relay_mule_ids: Set[str] = set()

    # ── batch refresh (called every GRAPH_ANALYTICS_INTERVAL) ──

    async def refresh(self) -> Dict[str, int]:
        """Re-run all detection queries and update caches."""
        counts: Dict[str, int] = {}

        try:
            self.fraud_islands = await self.neo4j.read_async(
                CQ.DETECT_FRAUD_ISLANDS, {"min_avg_risk": 40}
            )
            counts["fraud_islands"] = len(self.fraud_islands)
        except Exception as exc:  # noqa: BLE001
            logger.warning("fraud_islands query failed: %s", exc)
            counts["fraud_islands"] = 0

        try:
            self.money_routers = await self.neo4j.read_async(
                CQ.DETECT_MONEY_ROUTERS, {"min_betweenness": 0.01}
            )
            counts["money_routers"] = len(self.money_routers)
        except Exception as exc:  # noqa: BLE001
            logger.warning("money_routers query failed: %s", exc)
            counts["money_routers"] = 0

        try:
            self.circular_flows = await self.neo4j.read_async(CQ.DETECT_CIRCULAR_FLOWS)
            counts["circular_flows"] = len(self.circular_flows)
        except Exception as exc:  # noqa: BLE001
            logger.warning("circular_flows query failed: %s", exc)
            counts["circular_flows"] = 0

        try:
            self.rapid_chains = await self.neo4j.read_async(CQ.DETECT_RAPID_CHAINS)
            counts["rapid_chains"] = len(self.rapid_chains)
        except Exception as exc:  # noqa: BLE001
            logger.warning("rapid_chains query failed: %s", exc)
            counts["rapid_chains"] = 0

        try:
            self.star_hubs = await self.neo4j.read_async(
                CQ.DETECT_STAR_HUBS, {"min_in_degree": 5, "min_out_degree": 5}
            )
            counts["star_hubs"] = len(self.star_hubs)
        except Exception as exc:  # noqa: BLE001
            logger.warning("star_hubs query failed: %s", exc)
            counts["star_hubs"] = 0

        # ── relay mule detection (flow ratio analysis) ──
        try:
            self.relay_mules = await self.neo4j.read_async(
                CQ.DETECT_RELAY_MULE, {"min_flow_ratio": 0.75}
            )
            counts["relay_mules"] = len(self.relay_mules)
            # rebuild relay lookup
            self._relay_mule_ids = {
                r.get("user_id") for r in self.relay_mules if r.get("user_id")
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning("relay_mules query failed: %s", exc)
            counts["relay_mules"] = 0

        # rebuild user → cluster lookup
        self._user_clusters.clear()
        for island in self.fraud_islands:
            cid = str(island.get("cluster_id", ""))
            for uid in island.get("member_ids", []):
                self._user_clusters.setdefault(uid, set()).add(cid)

        logger.info(
            "Collusive detection refreshed – islands=%d routers=%d rings=%d chains=%d hubs=%d relays=%d",
            counts.get("fraud_islands", 0),
            counts.get("money_routers", 0),
            counts.get("circular_flows", 0),
            counts.get("rapid_chains", 0),
            counts.get("star_hubs", 0),
            counts.get("relay_mules", 0),
        )
        return counts

    # ── per-transaction fast lookup ────────────────────────────

    def get_user_flags(self, user_id: str) -> List[str]:
        """Return cached collusion flags for a user (O(1) lookup)."""
        flags: List[str] = []

        # cluster membership
        clusters = self._user_clusters.get(user_id, set())
        for cid in clusters:
            flags.append(f"Part of Fraud Cluster {cid}")

        # money router
        for router in self.money_routers:
            if router.get("user_id") == user_id:
                flags.append("Money Router (High Betweenness)")
                break

        # circular flow participant
        for ring in self.circular_flows:
            if user_id in (ring.get("node_a"), ring.get("node_b"), ring.get("node_c")):
                flags.append("Circular Money Flow Detected")
                break

        # star hub
        for hub in self.star_hubs:
            if hub.get("user_id") == user_id:
                flags.append(f"Star Hub ({hub.get('hub_type', 'RELAY')})")
                break

        # relay mule (O(1) set lookup)
        if user_id in self._relay_mule_ids:
            flags.append("HIGH_VELOCITY_RELAY: rapid fund relay pattern")

        return flags

    def get_user_cluster_id(self, user_id: str) -> str | None:
        """Return the primary fraud cluster the user belongs to."""
        clusters = self._user_clusters.get(user_id)
        if clusters:
            return next(iter(clusters))
        return None

    # ── summary for API / dashboard ────────────────────────────

    def summary(self) -> Dict[str, Any]:
        return {
            "fraud_islands": len(self.fraud_islands),
            "money_routers": len(self.money_routers),
            "circular_flows": len(self.circular_flows),
            "rapid_chains": len(self.rapid_chains),
            "star_hubs": len(self.star_hubs),
            "relay_mules": len(self.relay_mules),
            "details": {
                "islands": self.fraud_islands[:10],
                "routers": self.money_routers[:10],
                "rings": self.circular_flows[:10],
                "chains": self.rapid_chains[:10],
                "hubs": self.star_hubs[:10],
                "relays": self.relay_mules[:10],
            },
        }
