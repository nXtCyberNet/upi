"""
Graph-intelligence feature extraction.

Reads pre-computed GDS properties (community_id, betweenness, pagerank,
clustering_coeff) from the :User node and combines them with local
structural features (in/out degree, neighbour risk) into a single
graph risk sub-score  S_graph  ∈ [0, 100].
"""

from __future__ import annotations

import logging
from typing import Dict

from app.neo4j_manager import Neo4jManager
from app.utils.cypher_queries import (
    QUERY_USER_GRAPH_FEATURES,
    QUERY_COMMUNITY_STATS,
)
from app.config import settings

logger = logging.getLogger(__name__)


class GraphIntelligenceExtractor:
    """Per-transaction graph risk scoring (fast-path reads)."""

    def __init__(self, neo4j: Neo4jManager) -> None:
        self.neo4j = neo4j

    async def compute(self, user_id: str) -> Dict:
        """Return feature dict + fused graph risk 0–100."""

        rows = await self.neo4j.read_async(
            QUERY_USER_GRAPH_FEATURES, {"user_id": user_id}
        )
        if not rows:
            return {"user_id": user_id, "risk": 0.0, "flags": []}

        f = rows[0]
        in_degree: int = f.get("in_degree", 0) or 0
        out_degree: int = f.get("out_degree", 0) or 0
        betweenness: float = f.get("betweenness") or 0.0
        pagerank: float = f.get("pagerank") or 0.0
        clustering_coeff: float = f.get("clustering_coeff") or 0.0
        community_id = f.get("community_id")
        avg_neighbor_risk: float = f.get("avg_neighbor_risk", 0) or 0.0
        device_account_count: int = f.get("device_account_count", 0) or 0

        # ── community risk ───────────────────────────────────
        community_risk = 0.0
        cluster_id_str = None
        if community_id is not None:
            cluster_id_str = str(community_id)
            try:
                stats = await self.neo4j.read_async(
                    QUERY_COMMUNITY_STATS, {"community_id": community_id}
                )
                if stats:
                    s = stats[0]
                    member_count = s.get("member_count", 0) or 0
                    avg_risk = s.get("avg_risk", 0) or 0
                    high_risk_count = s.get("high_risk_count", 0) or 0
                    # dense high-risk cluster = suspicious
                    if member_count >= 3 and avg_risk > 50:
                        community_risk = min(avg_risk, 100)
                    elif high_risk_count >= 2:
                        community_risk = 40.0
            except Exception:  # noqa: BLE001
                pass

        # ── centrality risk (betweenness) ────────────────────
        # Normalised: typical betweenness for a 500-node graph peaks ~0.1
        centrality_score = min(betweenness * 200, 30)  # up to 30

        # ── pagerank risk ────────────────────────────────────
        # Higher pagerank = more "important" in transfer network → could be router
        pagerank_score = min(pagerank * 500, 15)  # up to 15

        # ── structural anomaly ───────────────────────────────
        structural_score = 0.0
        # Fan-out pattern (distributor)
        if out_degree >= 5 and in_degree <= 2:
            structural_score += 15
        # Fan-in pattern (collector)
        if in_degree >= 5 and out_degree <= 2:
            structural_score += 15
        # High local clustering + high degree = tightly-knit ring
        if clustering_coeff > 0.5 and (in_degree + out_degree) > 4:
            structural_score += 10

        # ── neighbour risk contagion ─────────────────────────
        neighbor_contagion = min(avg_neighbor_risk * 0.3, 15)

        # ── fuse ─────────────────────────────────────────────
        risk = (
            community_risk * 0.30
            + centrality_score
            + pagerank_score
            + structural_score
            + neighbor_contagion
        )
        risk = min(risk, 100.0)

        flags = []
        if betweenness > 0.05:
            flags.append("High Betweenness Node (Money Router)")
        if community_risk > 50:
            flags.append(f"Member of High-Risk Cluster {cluster_id_str}")
        if out_degree >= 5 and in_degree <= 2:
            flags.append("Fan-Out Hub (Distributor)")
        if in_degree >= 5 and out_degree <= 2:
            flags.append("Fan-In Hub (Collector)")

        return {
            "user_id": user_id,
            "in_degree": in_degree,
            "out_degree": out_degree,
            "betweenness": round(betweenness, 6),
            "pagerank": round(pagerank, 6),
            "clustering_coeff": round(clustering_coeff, 4),
            "community_id": cluster_id_str,
            "community_risk": round(community_risk, 2),
            "centrality_score": round(centrality_score, 2),
            "structural_score": round(structural_score, 2),
            "avg_neighbor_risk": round(avg_neighbor_risk, 2),
            "risk": round(risk, 2),
            "flags": flags,
        }
