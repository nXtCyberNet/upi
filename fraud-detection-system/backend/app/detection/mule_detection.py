"""
Mule account detection – v3 with SIM-swap, circadian, identicality signals.

Combines multiple feature signals to classify a user as a potential
money mule.  A mule typically:
  • Has a dormant or newly-created account (first-strike pattern)
  • Receives large inflows and quickly redistributes them
  • Uses a shared device or performs SIM-swaps
  • Is embedded in a high-risk graph cluster
  • Acts as a high-velocity relay (outflow ≈ inflow in short window)
  • Uses a new device with high amount + MPIN
  • Performs transactions at circadian-anomalous hours
  • Sends identical amounts to same receiver (structuring)
  • Is a "sleep-and-flash" mule (dormant >30d, ratio >50x)

This module doesn't compute its own sub-score – it aggregates the
outputs of the five feature extractors and applies heuristic rules
to generate explicit mule flags.
"""

from __future__ import annotations

import logging
from typing import Dict, List

logger = logging.getLogger(__name__)

# Thresholds (could be tuned or moved to config)
_MULE_RISK_THRESHOLD = 65
_PASSTHROUGH_THRESHOLD = 0.75
_DEVICE_SHARE_THRESHOLD = 3
_DORMANT_DAYS_THRESHOLD = 20


class MuleDetector:
    """Heuristic mule-classification on top of feature vectors."""

    def evaluate(
        self,
        behavioral: Dict,
        dead_account: Dict,
        device: Dict,
        graph: Dict,
        velocity: Dict,
        fused_risk: float,
    ) -> Dict:
        """
        Return:
            is_mule : bool
            confidence : float 0-1
            reasons : List[str]
        """
        reasons: List[str] = []
        score = 0.0  # accumulator 0 → 1

        # ── first-strike dormant activation ──────────────────
        if dead_account.get("is_first_strike"):
            score += 0.30
            days = dead_account.get("days_slept") or dead_account.get("days_inactive", 0)
            reasons.append(f"First-strike: dormant {int(days)}d → suddenly active")
        elif dead_account.get("is_dormant") and dead_account.get("risk", 0) > 40:
            score += 0.25
            reasons.append("Dormant account activated with suspicious inflow")

        # ── sleep-and-flash mule (woken mule) ────────────────
        if dead_account.get("sleep_flash_flag"):
            score += 0.25
            ratio = dead_account.get("sleep_flash_ratio", 0)
            reasons.append(
                f"Sleep-and-flash mule: amount {ratio:.0f}x historical avg, "
                f"dormant >30d"
            )

        # ── high pass-through (relay pattern) ────────────────
        pt_ratio = velocity.get("outflow_inflow_ratio", 0)
        if pt_ratio > _PASSTHROUGH_THRESHOLD:
            score += 0.20
            reasons.append(f"High pass-through ratio ({pt_ratio:.2f})")

        # ── shared device ────────────────────────────────────
        if device.get("account_count", 0) >= _DEVICE_SHARE_THRESHOLD:
            score += 0.15
            reasons.append(
                f"Device shared across {device['account_count']} accounts"
            )

        # ── SIM-swap multi-user device ───────────────────────
        if device.get("device_multi_user_flag"):
            score += 0.20
            reasons.append(
                f"SIM-swap: {device.get('device_multi_user_count', 0)} users "
                f"on same device in 24h"
            )

        # ── graph cluster membership ─────────────────────────
        if graph.get("community_risk", 0) > 50:
            score += 0.15
            reasons.append(
                f"Member of high-risk cluster (risk={graph['community_risk']:.0f})"
            )

        # ── relay mule flag from velocity ────────────────────
        if velocity.get("tx_per_min", 0) > 5 and pt_ratio > 0.6:
            score += 0.10
            reasons.append(
                f"Relay pattern: {velocity['tx_per_min']:.1f} tx/min, "
                f"ratio={pt_ratio:.2f}"
            )

        # ── behavioural anomaly ──────────────────────────────
        if behavioral.get("impossible_travel"):
            score += 0.10
            reasons.append("Impossible travel detected")
        if behavioral.get("spike_flag"):
            score += 0.05
            reasons.append("Amount spike vs historical baseline")

        # ── new device + high amount + MPIN compound ─────────
        if device.get("new_device_high_mpin"):
            score += 0.15
            reasons.append("New device + high amount + MPIN authentication")

        # ── capability mask anomaly ──────────────────────────
        if device.get("cap_mask_anomaly", 0) >= 2:
            score += 0.08
            reasons.append(
                f"Device capability mask changed (Hamming={device['cap_mask_anomaly']})"
            )

        # ── new/unknown device ───────────────────────────────
        if device.get("new_device_flag") and not device.get("new_device_high_mpin"):
            score += 0.05
            reasons.append("Transaction from new/unseen device")

        # ── IP rotation pattern ──────────────────────────────
        if behavioral.get("ip_rotation_flag"):
            score += 0.08
            ip_count = behavioral.get("ip_rotation_count", 0)
            reasons.append(f"IP rotation: {ip_count} unique IPs in 24h")

        # ── fixed-amount pattern (structuring) ───────────────
        if behavioral.get("fixed_amount_flag"):
            score += 0.08
            reasons.append("Fixed-amount pattern (possible structuring)")

        # ── circadian anomaly ────────────────────────────────
        if behavioral.get("circadian_anomaly"):
            score += 0.10
            reasons.append("Transaction at unusual hour for user's pattern")

        # ── TX identicality index ────────────────────────────
        if behavioral.get("tx_identicality_flag"):
            score += 0.15
            count = behavioral.get("tx_identicality_count", 0)
            reasons.append(
                f"TX identicality: {count} identical-amount transfers "
                f"to same receiver in 1h"
            )

        score = min(score, 1.0)
        is_mule = score >= 0.5 or fused_risk >= _MULE_RISK_THRESHOLD

        return {
            "is_mule": is_mule,
            "confidence": round(score, 3),
            "reasons": reasons,
        }
