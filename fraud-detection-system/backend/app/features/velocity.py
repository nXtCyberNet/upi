"""
Velocity & pass-through feature extraction.

Measures how fast money moves through a user within a sliding time window.
High turnover (inflow ≈ outflow in short time) is a strong mule indicator.

Risk sub-score  S_velocity  ∈ [0, 100]
"""

from __future__ import annotations

import logging
from typing import Dict

from app.neo4j_manager import Neo4jManager
from app.utils.cypher_queries import QUERY_VELOCITY_FEATURES
from app.config import settings

logger = logging.getLogger(__name__)


class VelocityExtractor:
    """Time-windowed velocity and pass-through scoring."""

    def __init__(self, neo4j: Neo4jManager) -> None:
        self.neo4j = neo4j

    async def compute(self, user_id: str, tx_amount: float) -> Dict:
        """Return feature dict + fused velocity risk 0–100."""

        rows = await self.neo4j.read_async(
            QUERY_VELOCITY_FEATURES,
            {"user_id": user_id, "window": settings.VELOCITY_WINDOW_SEC},
        )
        if not rows:
            return {"user_id": user_id, "risk": 0.0, "flags": []}

        f = rows[0]
        send_count: int = f.get("send_count", 0) or 0
        receive_count: int = f.get("receive_count", 0) or 0
        total_sent: float = f.get("total_sent_window", 0) or 0
        total_received: float = f.get("total_received_window", 0) or 0
        outflow_inflow_ratio: float = f.get("outflow_inflow_ratio", 0) or 0
        total_activity: int = f.get("total_activity", 0) or 0

        # ── burst detection ──────────────────────────────────
        burst_score = 0.0
        if total_activity >= settings.BURST_TX_THRESHOLD:
            burst_score = 30.0
        elif total_activity >= settings.BURST_TX_THRESHOLD // 2:
            burst_score = 15.0

        # ── pass-through (high turnover) ─────────────────────
        pass_through_score = 0.0
        if total_received > 0:
            ratio = total_sent / total_received
            if ratio > settings.PASS_THROUGH_RATIO_THRESHOLD:
                pass_through_score = min(ratio / 1.5, 1.0) * 35  # up to 35
            elif ratio > 0.5:
                pass_through_score = 10.0

        # ── velocity (tx per minute) ─────────────────────────
        tx_per_min = total_activity / max(settings.VELOCITY_WINDOW_SEC / 60, 1)
        velocity_component = min(tx_per_min / 10, 1.0) * 20  # up to 20

        # ── high single-tx to window ratio ───────────────────
        single_tx_ratio_score = 0.0
        if total_sent > 0:
            ratio = tx_amount / total_sent
            if ratio > 0.8:
                single_tx_ratio_score = 15.0

        # ── fuse ─────────────────────────────────────────────
        risk = burst_score + pass_through_score + velocity_component + single_tx_ratio_score
        risk = min(risk, 100.0)

        flags = []
        if burst_score >= 30:
            flags.append("Transaction Burst Detected")
        if pass_through_score > 25:
            flags.append("Rapid Pass-Through Pattern")
        if tx_per_min > 5:
            flags.append(f"High Velocity: {tx_per_min:.1f} tx/min")

        return {
            "user_id": user_id,
            "send_count": send_count,
            "receive_count": receive_count,
            "total_sent_window": round(total_sent, 2),
            "total_received_window": round(total_received, 2),
            "outflow_inflow_ratio": round(outflow_inflow_ratio, 4),
            "burst_score": round(burst_score, 2),
            "pass_through_score": round(pass_through_score, 2),
            "velocity_component": round(velocity_component, 2),
            "tx_per_min": round(tx_per_min, 2),
            "risk": round(risk, 2),
            "flags": flags,
        }
