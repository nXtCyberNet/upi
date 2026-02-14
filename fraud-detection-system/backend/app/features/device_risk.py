"""
Device-risk feature extraction (v3).

Queries the Neo4j :Device node and its :USES_DEVICE relationships to
compute risk signals around shared devices, device drift, capability
mask changes, multi-account device usage (SIM-swap), and new-device
high-amount patterns.

Active signals
──────────────
• new_device_flag            – device not seen before for this user
• device_drift_score         – OS family change, capability mask Δ
• capability_mask_anomaly    – mask changed vs historical mode
• device_multi_user_flag     – >3 users on same device in 24h (SIM-swap)
• new_device_high_mpin       – new device + high amount + MPIN credential

Discarded signals
─────────────────
• app_downgrade_flag    – Banks/NPCI force updates; if app is open, it's compliant
• outdated_app_score    – Same reasoning; discarded as risk signal

Risk sub-score  S_device  ∈ [0, 100]
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from app.neo4j_manager import Neo4jManager
from app.utils.cypher_queries import (
    QUERY_DEVICE_INFO,
    QUERY_DEVICE_RISK_PROPAGATION,
    QUERY_USER_DEVICE_HISTORY,
    QUERY_DEVICE_USERS_24H,
)
from app.config import settings

logger = logging.getLogger(__name__)


def _hamming_distance(a: Optional[str], b: Optional[str]) -> int:
    """Count bit differences between two binary mask strings."""
    if not a or not b:
        return 0
    # Pad to equal length
    max_len = max(len(a), len(b))
    a = a.zfill(max_len)
    b = b.zfill(max_len)
    return sum(c1 != c2 for c1, c2 in zip(a, b))


class DeviceRiskExtractor:
    """Evaluate device-level fraud risk with v3 signals."""

    def __init__(self, neo4j: Neo4jManager) -> None:
        self.neo4j = neo4j

    async def compute(
        self,
        device_id: str,
        sender_id: str,
        amount: float = 0.0,
        app_version: Optional[str] = None,
        capability_mask: Optional[str] = None,
        device_os: Optional[str] = None,
        credential_type: Optional[str] = None,
        credential_sub_type: Optional[str] = None,
    ) -> Dict:
        """Return feature dict + fused device risk 0–100."""

        # ── basic device info ────────────────────────────────
        info_rows = await self.neo4j.read_async(
            QUERY_DEVICE_INFO, {"device_id": device_id}
        )
        if not info_rows:
            # Brand new device — never seen at all
            return self._score_new_device(
                device_id, sender_id, amount, app_version,
                capability_mask, device_os, credential_type, credential_sub_type,
            )

        info = info_rows[0]
        account_count: int = info.get("account_count", 1) or 1
        stored_os = (info.get("os") or "").strip()
        stored_mask = info.get("capability_mask")

        # ── device history for this user (drift detection) ───
        history_rows = await self.neo4j.read_async(
            QUERY_USER_DEVICE_HISTORY, {"user_id": sender_id}
        )
        known_device_ids = [r["device_id"] for r in history_rows] if history_rows else []
        is_new_device = device_id not in known_device_ids

        # ── risk propagation from linked users ───────────────
        prop_rows = await self.neo4j.read_async(
            QUERY_DEVICE_RISK_PROPAGATION, {"device_id": device_id}
        )
        prop = prop_rows[0] if prop_rows else {}
        device_risk_score: float = prop.get("device_risk_score", 0)
        avg_user_risk: float = prop.get("avg_user_risk", 0) or 0
        max_user_risk: float = prop.get("max_user_risk", 0) or 0

        # ── SIM-swap: multi-user device in 24h ───────────
        multi_user_rows = await self.neo4j.read_async(
            QUERY_DEVICE_USERS_24H, {"device_id": device_id}
        )
        device_multi_user_count = 0
        device_multi_user_flag = False
        if multi_user_rows:
            device_multi_user_count = multi_user_rows[0].get("unique_users_24h", 0) or 0
            device_multi_user_flag = device_multi_user_count > settings.DEVICE_MULTI_USER_THRESHOLD

        # ══════════════════════════════════════════════════════
        # Scoring components
        # ══════════════════════════════════════════════════════

        # 1. Multi-account penalty (up to 40)
        multi_account_score = 0.0
        if account_count >= settings.DEVICE_ACCOUNT_THRESHOLD:
            multi_account_score = 40.0
        elif account_count >= 3:
            multi_account_score = 25.0
        elif account_count >= 2:
            multi_account_score = 10.0

        # 2. Risk propagation (up to 25)
        propagation_score = min(device_risk_score / 100.0, 1.0) * 25

        # 3. Neighbour high-risk bonus (up to 10)
        high_risk_bonus = 10.0 if max_user_risk > 80 else 0.0

        # 4. OS anomaly / non-standard (up to 10)
        os_anomaly_score = 0.0
        effective_os = device_os or stored_os
        if effective_os:
            os_lc = effective_os.lower()
            if not (os_lc.startswith("android") or os_lc.startswith("ios")):
                os_anomaly_score = 10.0

        # 5. Device drift score (up to 15)
        device_drift_score = 0.0
        drift_flags: List[str] = []

        # 5a. OS change (device reports different OS family)
        if stored_os and device_os:
            stored_family = stored_os.lower().split()[0] if stored_os else ""
            current_family = device_os.lower().split()[0] if device_os else ""
            if stored_family and current_family and stored_family != current_family:
                device_drift_score += 5.0
                drift_flags.append(f"OS family changed: {stored_os} → {device_os}")

        # 5b. Capability mask change (Hamming distance)
        cap_mask_anomaly = 0
        if capability_mask and stored_mask and capability_mask != stored_mask:
            cap_mask_anomaly = _hamming_distance(capability_mask, stored_mask)
            cap_mask_penalty = min(cap_mask_anomaly * settings.CAPABILITY_MASK_CHANGE_WEIGHT * 0.3, 5.0)
            device_drift_score += cap_mask_penalty
            drift_flags.append(
                f"Capability mask changed: {stored_mask} → {capability_mask} "
                f"(Hamming={cap_mask_anomaly})"
            )

        device_drift_score = min(device_drift_score, 15.0)

        # 6. New device penalty (up to 12)
        new_device_score = settings.NEW_DEVICE_PENALTY if is_new_device else 0.0

        # 7. SIM-swap multi-user device penalty (up to 25)
        sim_swap_score = settings.DEVICE_MULTI_USER_PENALTY if device_multi_user_flag else 0.0

        # 8. New device + high amount + MPIN (compound signal, up to 15)
        new_device_high_mpin_score = 0.0
        if (is_new_device
                and amount >= settings.NEW_DEVICE_HIGH_AMOUNT_THRESHOLD
                and credential_sub_type and credential_sub_type.upper() == "MPIN"):
            new_device_high_mpin_score = 15.0

        # ── fuse ─────────────────────────────────────────────
        risk = (
            multi_account_score
            + propagation_score
            + high_risk_bonus
            + os_anomaly_score
            + device_drift_score
            + new_device_score
            + sim_swap_score
            + new_device_high_mpin_score
        )
        risk = min(risk, 100.0)

        flags: List[str] = []
        if account_count >= settings.DEVICE_ACCOUNT_THRESHOLD:
            flags.append(f"Shared Device: {account_count} accounts")
        if max_user_risk > 80:
            flags.append("Device Linked to High-Risk User")
        if os_anomaly_score > 0:
            flags.append(f"Unsupported Device OS: {effective_os}")
        if is_new_device:
            flags.append("New Device for User")
        if cap_mask_anomaly > 0:
            flags.append(f"Capability Mask Changed (Hamming={cap_mask_anomaly})")
        if new_device_high_mpin_score > 0:
            flags.append("New Device + High Amount + MPIN")
        if device_multi_user_flag:
            flags.append(f"SIM-Swap: {device_multi_user_count} users on device in 24h")
        flags.extend(drift_flags)

        return {
            "device_id": device_id,
            "account_count": account_count,
            "device_os": effective_os,
            "app_version": app_version,
            "capability_mask": capability_mask,
            "avg_user_risk": round(avg_user_risk, 2),
            "max_user_risk": round(max_user_risk, 2),
            "multi_account_score": round(multi_account_score, 2),
            "propagation_score": round(propagation_score, 2),
            "os_anomaly_score": round(os_anomaly_score, 2),
            "device_drift_score": round(device_drift_score, 2),
            "new_device_flag": is_new_device,
            "new_device_score": round(new_device_score, 2),
            "cap_mask_anomaly": cap_mask_anomaly,
            "new_device_high_mpin": new_device_high_mpin_score > 0,
            "device_multi_user_flag": device_multi_user_flag,
            "device_multi_user_count": device_multi_user_count,
            "sim_swap_score": round(sim_swap_score, 2),
            "risk": round(risk, 2),
            "flags": flags,
        }

    def _score_new_device(
        self, device_id: str, sender_id: str, amount: float,
        app_version: Optional[str], capability_mask: Optional[str],
        device_os: Optional[str], credential_type: Optional[str],
        credential_sub_type: Optional[str],
    ) -> Dict:
        """Score a device never seen in the graph."""
        risk = settings.NEW_DEVICE_PENALTY  # base new-device penalty

        flags = ["New Device (First Appearance)"]

        # Compound: new device + high amount + MPIN
        compound = 0.0
        if (amount >= settings.NEW_DEVICE_HIGH_AMOUNT_THRESHOLD
                and credential_sub_type and credential_sub_type.upper() == "MPIN"):
            compound = 15.0
            flags.append("New Device + High Amount + MPIN")

        risk += compound
        risk = min(risk, 100.0)

        return {
            "device_id": device_id,
            "account_count": 0,
            "device_os": device_os,
            "app_version": app_version,
            "capability_mask": capability_mask,
            "avg_user_risk": 0.0,
            "max_user_risk": 0.0,
            "multi_account_score": 0.0,
            "propagation_score": 0.0,
            "os_anomaly_score": 0.0,
            "device_drift_score": 0.0,
            "new_device_flag": True,
            "new_device_score": settings.NEW_DEVICE_PENALTY,
            "cap_mask_anomaly": 0,
            "new_device_high_mpin": compound > 0,
            "device_multi_user_flag": False,
            "device_multi_user_count": 0,
            "sim_swap_score": 0.0,
            "risk": round(risk, 2),
            "flags": flags,
        }
