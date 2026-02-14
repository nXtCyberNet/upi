"""
Risk fusion engine – optimised with explainability (v2).

Orchestrates all five feature extractors, applies the weighted fusion
formula, determines risk level, collects flags, generates human-readable
reason strings, and returns an explainable RiskResponse.

Fusion formula:
    R = 0.30 × S_graph
      + 0.25 × S_behavioral
      + 0.20 × S_device
      + 0.15 × S_dead_account
      + 0.10 × S_velocity
"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Dict, List, Optional

from app.config import settings
from app.neo4j_manager import Neo4jManager
from app.features.behavioral import BehavioralFeatureExtractor
from app.features.dead_account import DeadAccountDetector
from app.features.device_risk import DeviceRiskExtractor
from app.features.graph_intelligence import GraphIntelligenceExtractor
from app.features.velocity import VelocityExtractor
from app.detection.mule_detection import MuleDetector
from app.detection.collusive_fraud import CollusiveFraudDetector
from app.models.transaction import TransactionInput, RiskLevel, TransactionStatus
from app.models.risk_score import RiskBreakdown, RiskResponse
from app.utils.cypher_queries import UPDATE_TX_RISK, UPDATE_USER_RISK

logger = logging.getLogger(__name__)


# ── Explainability helpers ───────────────────────────────────

def _build_reason(
    behav: Dict, dead: Dict, device: Dict, graph: Dict, vel: Dict,
    fused: float, flags: List[str],
) -> str:
    """Generate a concise human-readable reason string."""
    parts: List[str] = []

    # Dead account / dormant
    if dead.get("is_dormant") or dead.get("is_first_strike"):
        days = dead.get("days_inactive") or dead.get("days_slept", 0)
        parts.append(f"Account activated after {int(days)} days of inactivity")
    if dead.get("pass_through_ratio", 0) > settings.PASS_THROUGH_RATIO_THRESHOLD:
        parts.append(
            f"Pass-through ratio {dead['pass_through_ratio']:.0%} exceeds threshold"
        )
    if dead.get("sleep_flash_flag"):
        ratio = dead.get("sleep_flash_ratio", 0)
        parts.append(
            f"Sleep-and-flash mule: amount {ratio:.0f}x above historical avg, "
            f"dormant >30d"
        )

    # Graph intelligence
    if graph.get("community_risk", 0) > 50:
        cid = graph.get("community_id", "?")
        parts.append(
            f"Community #{cid} has {graph['community_risk']:.0f}% fraud density"
        )
    if graph.get("betweenness", 0) > 0.01:
        parts.append("High betweenness centrality (money router)")

    # Device risk (v3 signals)
    acc_cnt = device.get("account_count", 0)
    if acc_cnt >= settings.DEVICE_ACCOUNT_THRESHOLD:
        parts.append(f"Shared device with {acc_cnt} other accounts")
    if device.get("new_device_flag"):
        parts.append("Transaction from a new/unseen device")
    if device.get("cap_mask_anomaly", 0) > 0:
        parts.append("Device capability mask changed unexpectedly")
    if device.get("new_device_high_mpin"):
        parts.append("New device + high amount + MPIN authentication")
    if device.get("device_multi_user_flag"):
        parts.append(
            f"SIM-swap: {device.get('device_multi_user_count', 0)} users on "
            f"same device in 24h"
        )

    # Behavioral
    if behav.get("impossible_travel"):
        parts.append("Impossible travel detected between consecutive transactions")
    if behav.get("amount_zscore", 0) > 3:
        parts.append(
            f"Amount z-score {behav['amount_zscore']:.1f}x above user baseline"
        )
    if behav.get("is_night"):
        parts.append("Unusual night-time transaction")
    if behav.get("asn_risk", 0) >= 0.5:
        asn_class = behav.get("asn_class", "UNKNOWN")
        asn_country = behav.get("asn_country", "")
        parts.append(f"High ASN risk: {asn_class} network (country: {asn_country})")
    if behav.get("foreign_flag"):
        parts.append(f"Foreign IP origin: {behav.get('asn_country', '?')}")
    if behav.get("asn_drift"):
        parts.append("ASN drift: unusual network for this user")
    if behav.get("ip_rotation_flag"):
        parts.append(f"IP rotation: {behav.get('ip_rotation_count', 0)} unique IPs in 24h")
    if behav.get("fixed_amount_flag"):
        parts.append("Fixed-amount pattern: repeated identical transfers")
    if behav.get("circadian_anomaly"):
        parts.append("Circadian anomaly: transaction at unusual hour for this user")
    if behav.get("tx_identicality_flag"):
        parts.append(
            f"TX identicality: {behav.get('tx_identicality_count', 0)} identical-amount "
            f"transfers to same receiver"
        )

    # Velocity
    if vel.get("tx_per_min", 0) > 5:
        parts.append(f"Velocity: {vel['tx_per_min']:.1f} tx/min in last window")
    if vel.get("outflow_inflow_ratio", 0) > settings.PASS_THROUGH_RATIO_THRESHOLD:
        parts.append("Rapid fund relay pattern")

    if not parts:
        if fused >= settings.HIGH_RISK_THRESHOLD:
            parts.append("Multiple minor indicators combined above threshold")
        else:
            return "No significant risk indicators"

    return ". ".join(parts) + "."


class RiskEngine:
    """Central risk scoring engine – one instance per app."""

    def __init__(self, neo4j: Neo4jManager) -> None:
        self.neo4j = neo4j

        # feature extractors
        self.behavioral = BehavioralFeatureExtractor(neo4j)
        self.dead_account = DeadAccountDetector(neo4j)
        self.device_risk = DeviceRiskExtractor(neo4j)
        self.graph_intel = GraphIntelligenceExtractor(neo4j)
        self.velocity = VelocityExtractor(neo4j)

        # detection modules
        self.mule_detector = MuleDetector()
        self.collusive_detector: Optional[CollusiveFraudDetector] = None

    def set_collusive_detector(self, detector: CollusiveFraudDetector) -> None:
        self.collusive_detector = detector

    # ── main entry point ─────────────────────────────────────

    async def score_transaction(self, tx: TransactionInput) -> RiskResponse:
        """
        Full scoring pipeline for a single transaction.
        Target latency: < 200 ms.
        """
        t0 = time.perf_counter()

        # 1. Run all five feature extractors concurrently
        #    (they are I/O-bound Neo4j reads)
        import asyncio

        behav_task = asyncio.create_task(
            self.behavioral.compute(
                tx.sender_id, tx.amount, tx.timestamp,
                tx.sender_lat, tx.sender_lon,
                tx.ip_address,
                receiver_id=tx.receiver_id,
            )
        )
        dead_task = asyncio.create_task(
            self.dead_account.compute(tx.sender_id, tx.amount)
        )
        device_task = asyncio.create_task(
            self.device_risk.compute(
                device_id=tx.device_id,
                sender_id=tx.sender_id,
                amount=tx.amount,
                app_version=tx.app_version,
                capability_mask=tx.capability_mask,
                device_os=tx.device_os,
                credential_type=tx.credential_type.value if tx.credential_type else None,
                credential_sub_type=tx.credential_sub_type.value if tx.credential_sub_type else None,
            )
        )
        graph_task = asyncio.create_task(
            self.graph_intel.compute(tx.sender_id)
        )
        vel_task = asyncio.create_task(
            self.velocity.compute(tx.sender_id, tx.amount)
        )

        behav, dead, device, graph, vel = await asyncio.gather(
            behav_task, dead_task, device_task, graph_task, vel_task
        )

        # 2. Extract sub-scores (each 0–100)
        s_behavioral = behav.get("risk", 0)
        s_dead = dead.get("risk", 0)
        s_device = device.get("risk", 0)
        s_graph = graph.get("risk", 0)
        s_velocity = vel.get("risk", 0)

        # 2b. Circadian + New Device compound boost
        #     If circadian anomaly detected AND device is new, amplify behavioral
        if behav.get("circadian_anomaly") and device.get("new_device_flag"):
            circadian_boost = settings.CIRCADIAN_NEW_DEVICE_PENALTY - settings.CIRCADIAN_ANOMALY_PENALTY
            s_behavioral = min(s_behavioral + circadian_boost, 100.0)

        # 3. Weighted fusion
        fused = (
            settings.WEIGHT_GRAPH * s_graph
            + settings.WEIGHT_BEHAVIORAL * s_behavioral
            + settings.WEIGHT_DEVICE * s_device
            + settings.WEIGHT_DEAD_ACCOUNT * s_dead
            + settings.WEIGHT_VELOCITY * s_velocity
        )
        fused = min(fused, 100.0)

        # 4. Risk level
        if fused >= settings.HIGH_RISK_THRESHOLD:
            risk_level = RiskLevel.HIGH
        elif fused >= settings.MEDIUM_RISK_THRESHOLD:
            risk_level = RiskLevel.MEDIUM
        else:
            risk_level = RiskLevel.LOW

        # 5. Collect flags
        flags: list[str] = []
        flags.extend(behav.get("flags", []))
        flags.extend(dead.get("flags", []))
        flags.extend(device.get("flags", []))
        flags.extend(graph.get("flags", []))
        flags.extend(vel.get("flags", []))

        # Collusive flags from cached detector
        if self.collusive_detector:
            flags.extend(self.collusive_detector.get_user_flags(tx.sender_id))

        # Mule evaluation
        mule = self.mule_detector.evaluate(behav, dead, device, graph, vel, fused)
        if mule["is_mule"]:
            flags.append(f"MULE SUSPECTED (confidence={mule['confidence']:.0%})")
            flags.extend(mule["reasons"])

        # Deduplicate flags
        flags = list(dict.fromkeys(flags))

        # Cluster id
        cluster_id = graph.get("community_id")
        if not cluster_id and self.collusive_detector:
            cluster_id = self.collusive_detector.get_user_cluster_id(tx.sender_id)

        # 6. Explainability reason
        reason = _build_reason(behav, dead, device, graph, vel, fused, flags)

        # 7. Breakdown
        breakdown = RiskBreakdown(
            graph=round(s_graph, 2),
            behavioral=round(s_behavioral, 2),
            device=round(s_device, 2),
            dead_account=round(s_dead, 2),
            velocity=round(s_velocity, 2),
        )

        elapsed_ms = (time.perf_counter() - t0) * 1000

        # 8. Write risk back to Neo4j (fire-and-forget style)
        status = (
            TransactionStatus.FLAGGED
            if risk_level in (RiskLevel.HIGH, RiskLevel.CRITICAL)
            else TransactionStatus.COMPLETED
        )
        try:
            await self.neo4j.write_async(
                UPDATE_TX_RISK,
                {
                    "tx_id": tx.tx_id,
                    "risk_score": round(fused, 2),
                    "status": status.value,
                    "reason": reason,
                    "sender_lat": tx.sender_lat,
                    "sender_lon": tx.sender_lon,
                },
            )
            await self.neo4j.write_async(
                UPDATE_USER_RISK,
                {"user_id": tx.sender_id, "risk_score": round(fused, 2)},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to persist risk score: %s", exc)

        return RiskResponse(
            tx_id=tx.tx_id,
            risk_score=round(fused, 2),
            risk_level=risk_level,
            breakdown=breakdown,
            cluster_id=cluster_id,
            flags=flags,
            reason=reason,
            processing_time_ms=round(elapsed_ms, 2),
            timestamp=tx.timestamp,
        )
