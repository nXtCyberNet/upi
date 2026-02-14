"""
Dead / dormant account activation detector – optimised.

A "dead" account is one with no activity for >30 days AND low historical
transaction count.  When such an account suddenly receives large inflows
and rapidly passes them through, it's a classic mule-activation pattern.

Optimisations:
  • "First Strike" detection via QUERY_DORMANT_WAKEUP – single round-trip
    captures days_slept, recent_volume, is_first_strike, is_volume_spike
  • Falls back to standard two-query path if wakeup query returns nothing

Risk sub-score  S_dead  ∈ [0, 100]
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Dict

from app.neo4j_manager import Neo4jManager
from app.utils.cypher_queries import (
    QUERY_DORMANT_STATUS,
    QUERY_DORMANT_WAKEUP,
    QUERY_RECENT_INFLOW_OUTFLOW,
)
from app.config import settings

logger = logging.getLogger(__name__)


class DeadAccountDetector:
    """Evaluate dormant-account activation risk for a given user."""

    def __init__(self, neo4j: Neo4jManager) -> None:
        self.neo4j = neo4j

    async def compute(self, user_id: str, tx_amount: float) -> Dict:
        """Return feature dict + fused dead-account risk 0–100."""

        # ── Try first-strike single-query path ───────────────
        wakeup_rows = await self.neo4j.read_async(
            QUERY_DORMANT_WAKEUP,
            {"user_id": user_id, "dormant_days": settings.DORMANT_DAYS_THRESHOLD},
        )

        if wakeup_rows:
            return self._score_from_wakeup(wakeup_rows[0], tx_amount)

        # ── Fallback: original two-query path ────────────────
        return await self._score_legacy(user_id, tx_amount)

    # ── first-strike scoring (single Neo4j round-trip) ───────

    def _score_from_wakeup(self, w: Dict, tx_amount: float) -> Dict:
        is_dormant: bool = w.get("is_dormant", False)
        is_first_strike: bool = w.get("is_first_strike", False)
        is_volume_spike: bool = w.get("is_volume_spike", False)
        days_slept = w.get("days_slept") or 0
        # Handle neo4j duration/int
        if hasattr(days_slept, "days"):
            days_slept = days_slept.days
        days_slept = float(days_slept)
        tx_count: int = w.get("tx_count", 0) or 0
        avg_amount: float = w.get("avg_tx_amount", 0) or 0
        recent_volume: float = w.get("recent_volume", 0) or 0

        # ── inactivity score (up to 30) ──────────────────────
        inactivity_score = min(days_slept / settings.DORMANT_DAYS_THRESHOLD, 1.0) * 30

        # ── spike score (up to 30) ───────────────────────────
        spike_score = 0.0
        if avg_amount > 0:
            ratio = tx_amount / avg_amount
            spike_score = min(ratio / 10.0, 1.0) * 30
        elif tx_amount > 5000:
            spike_score = 25.0

        # ── first-strike bonus (up to 20) ────────────────────
        first_strike_bonus = 0.0
        if is_first_strike:
            first_strike_bonus = 20.0
        if is_volume_spike:
            first_strike_bonus = min(first_strike_bonus + 10.0, 25.0)

        # ── low historical activity bonus ────────────────────
        low_activity_bonus = 10.0 if tx_count <= 3 else 0.0

        # ── Sleep-and-Flash mule detection ───────────────────
        # Velocity of Historical Deviation: current/avg > 50 AND dormant > 30d
        sleep_flash_flag = False
        sleep_flash_ratio = 0.0
        if avg_amount > 0:
            sleep_flash_ratio = tx_amount / avg_amount
        if (sleep_flash_ratio >= settings.SLEEP_FLASH_RATIO_THRESHOLD
                and days_slept >= settings.SLEEP_FLASH_DORMANT_DAYS):
            sleep_flash_flag = True

        # ── fused risk ───────────────────────────────────────
        risk = 0.0
        if is_dormant or is_first_strike or days_slept > settings.DORMANT_DAYS_THRESHOLD:
            risk = inactivity_score + spike_score + first_strike_bonus + low_activity_bonus
            if sleep_flash_flag:
                risk += 20.0  # extra penalty for woken-mule pattern
        else:
            risk = spike_score * 0.3

        risk = min(risk, 100.0)

        flags = []
        if is_first_strike:
            flags.append(f"First-Strike: Dormant {int(days_slept)}d → active")
        elif is_dormant and risk > 40:
            flags.append("Dormant Account Activated")
        if is_volume_spike:
            flags.append("Volume Spike After Dormancy")
        if spike_score > 20:
            flags.append("Sudden Volume Spike on Dormant Account")
        if sleep_flash_flag:
            flags.append(
                f"Sleep-and-Flash Mule: ratio={sleep_flash_ratio:.0f}x, "
                f"dormant={int(days_slept)}d"
            )

        return {
            "is_dormant": is_dormant,
            "is_first_strike": is_first_strike,
            "days_inactive": round(days_slept, 1),
            "days_slept": round(days_slept, 1),
            "inactivity_score": round(inactivity_score, 2),
            "spike_score": round(spike_score, 2),
            "first_strike_bonus": round(first_strike_bonus, 2),
            "pass_through_ratio": 0.0,
            "pass_through_score": 0.0,
            "tx_count": tx_count,
            "sleep_flash_flag": sleep_flash_flag,
            "sleep_flash_ratio": round(sleep_flash_ratio, 2),
            "risk": round(risk, 2),
            "flags": flags,
        }

    # ── legacy two-query path ────────────────────────────────

    async def _score_legacy(self, user_id: str, tx_amount: float) -> Dict:
        rows = await self.neo4j.read_async(
            QUERY_DORMANT_STATUS, {"user_id": user_id}
        )
        if not rows:
            return {"is_dormant": False, "risk": 0.0, "flags": []}

        profile = rows[0]
        is_dormant: bool = profile.get("is_dormant", False)
        last_active = profile.get("last_active")  # datetime | None
        tx_count: int = profile.get("tx_count", 0) or 0
        avg_amount: float = profile.get("avg_tx_amount", 0) or 0

        # ── inactivity score ─────────────────────────────────
        days_inactive = 0.0
        if last_active and isinstance(last_active, datetime):
            days_inactive = (datetime.utcnow() - last_active.replace(tzinfo=None)).total_seconds() / 86400

        inactivity_score = min(days_inactive / settings.DORMANT_DAYS_THRESHOLD, 1.0) * 30

        # ── sudden volume spike ──────────────────────────────
        spike_score = 0.0
        if avg_amount > 0:
            ratio = tx_amount / avg_amount
            spike_score = min(ratio / 10.0, 1.0) * 30
        elif tx_amount > 5000:
            spike_score = 25.0

        # ── pass-through ratio (recent window) ───────────────
        flow_rows = await self.neo4j.read_async(
            QUERY_RECENT_INFLOW_OUTFLOW,
            {"user_id": user_id, "window": settings.VELOCITY_WINDOW_SEC * 10},
        )
        pass_through_ratio = 0.0
        pass_through_score = 0.0
        if flow_rows:
            f = flow_rows[0]
            inflow = f.get("recent_inflow", 0) or 0
            outflow = f.get("recent_outflow", 0) or 0
            if inflow > 0:
                pass_through_ratio = outflow / inflow
            pass_through_score = (
                min(pass_through_ratio / settings.PASS_THROUGH_RATIO_THRESHOLD, 1.0) * 30
            )

        # ── low historical activity bonus ────────────────────
        low_activity_bonus = 10.0 if tx_count <= 3 else 0.0

        # ── fused risk ───────────────────────────────────────
        risk = 0.0
        if is_dormant or days_inactive > settings.DORMANT_DAYS_THRESHOLD:
            risk = inactivity_score + spike_score + pass_through_score + low_activity_bonus
        else:
            risk = spike_score * 0.3 + pass_through_score * 0.3

        risk = min(risk, 100.0)

        flags = []
        if is_dormant and risk > 40:
            flags.append("Dormant Account Activated")
        if pass_through_ratio > settings.PASS_THROUGH_RATIO_THRESHOLD:
            flags.append("High Pass-Through Ratio")
        if spike_score > 20:
            flags.append("Sudden Volume Spike on Dormant Account")

        return {
            "is_dormant": is_dormant,
            "is_first_strike": False,
            "days_inactive": round(days_inactive, 1),
            "inactivity_score": round(inactivity_score, 2),
            "spike_score": round(spike_score, 2),
            "pass_through_ratio": round(pass_through_ratio, 4),
            "pass_through_score": round(pass_through_score, 2),
            "tx_count": tx_count,
            "risk": round(risk, 2),
            "flags": flags,
        }
