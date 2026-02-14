"""
Behavioural feature extraction (v3).

Computes per-transaction anomaly signals from the sender's recent history
stored in Neo4j.  Returns a 0–100 behavioural risk score.

Features
────────
• amount_zscore          – how many σ the current amount deviates
• iqr_outlier_flag       – robust outlier detection via IQR method
• rolling_mean / std     – 25-tx rolling stats
• time_since_last_tx     – seconds since previous transaction
• velocity_score         – tx/min in the recent window
• geo_distance           – km from last known location
• impossible_travel_flag – travel speed > 250 km/h
• ip_risk_score          – cloud ASN + reuse density
• night_anomaly_flag     – tx between 23:00 – 05:00
• ip_rotation_flag       – unique IPs in 24h window
• fixed_amount_flag      – repeated identical amounts
• circadian_anomaly      – tx at unusual hour for user’s historical pattern
• tx_identicality_flag   – same amount to same receiver >3× in 1h

Discarded signals
─────────────────
• mahalanobis_distance  – Requires N>30 to be stable; replaced by Z-Score & IQR
"""

from __future__ import annotations

import math
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

import numpy as np

from app.neo4j_manager import Neo4jManager
from app.utils.cypher_queries import (
    QUERY_USER_TX_HISTORY,
    QUERY_USER_PROFILE,
    QUERY_IP_ROTATION,
    QUERY_RECENT_AMOUNTS,
    QUERY_USER_HOUR_DISTRIBUTION,
    QUERY_IDENTICAL_TX_RECEIVER,
)
from app.features.asn_intelligence import compute_asn_risk
from app.detection.anomaly_detection import iqr_outlier
from app.config import settings

logger = logging.getLogger(__name__)


# ── helpers ──────────────────────────────────────────────────

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points on Earth."""
    R = 6371.0  # Earth radius km
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    Δφ = math.radians(lat2 - lat1)
    Δλ = math.radians(lon2 - lon1)
    a = math.sin(Δφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(Δλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _detect_fixed_amount_pattern(amounts: List[float], current: float, tolerance: float, min_count: int) -> bool:
    """Check if current amount matches a repeated fixed-amount pattern."""
    if len(amounts) < min_count:
        return False
    count = sum(1 for a in amounts if abs(a - current) / max(current, 1) <= tolerance)
    return count >= min_count


# ── main class ───────────────────────────────────────────────

class BehavioralFeatureExtractor:
    """Extract behavioural anomaly features for a single transaction."""

    def __init__(self, neo4j: Neo4jManager) -> None:
        self.neo4j = neo4j

    async def compute(
        self,
        sender_id: str,
        amount: float,
        timestamp: datetime,
        sender_lat: Optional[float] = None,
        sender_lon: Optional[float] = None,
        ip_address: Optional[str] = None,
        receiver_id: Optional[str] = None,
        is_new_device: bool = False,
    ) -> Dict:
        """Return a dict of feature values + a fused behavioural risk 0–100."""

        # Fetch recent history + profile in parallel-ish (same event loop)
        history = await self.neo4j.read_async(
            QUERY_USER_TX_HISTORY,
            {"user_id": sender_id, "limit": settings.BEHAVIORAL_HISTORY_COUNT},
        )
        profile_rows = await self.neo4j.read_async(
            QUERY_USER_PROFILE, {"user_id": sender_id}
        )
        profile = profile_rows[0] if profile_rows else {}

        amounts: List[float] = [r["amount"] for r in history if r.get("amount")]
        timestamps: List[datetime] = [r["timestamp"] for r in history if r.get("timestamp")]

        # ── amount features (3σ rule for spike detection) ────
        profile_mean = profile.get("avg_tx_amount") or 0.0
        profile_std = profile.get("std_tx_amount") or 0.0

        if len(amounts) >= 2:
            mean_a = float(np.mean(amounts))
            std_a = float(np.std(amounts)) or 1.0
            amount_zscore = (amount - mean_a) / std_a
            rolling_mean = mean_a
            rolling_std = std_a
            spike = amount > mean_a + 3 * std_a
        elif profile_mean > 0:
            mean_a = profile_mean
            std_a = profile_std if profile_std > 0 else profile_mean * 0.5
            amount_zscore = (amount - mean_a) / std_a
            rolling_mean = mean_a
            rolling_std = std_a
            spike = amount > mean_a + 3 * std_a
        else:
            amount_zscore = 0.0
            rolling_mean = amount
            rolling_std = 0.0
            spike = False

        # Dormant-burst cross-signal
        is_dormant = profile.get("is_dormant", False)
        dormant_burst = is_dormant and profile_mean > 0 and amount > profile_mean

        # ── ASN intelligence (MMDB-based Indian IPv4 classification) ──
        asn_result: Dict = {}
        asn_risk_scaled = 0.0
        if ip_address:
            asn_result = await compute_asn_risk(sender_id, ip_address, self.neo4j)
            asn_risk_scaled = asn_result.get("asn_risk_scaled", 0.0)

        # ── temporal features ────────────────────────────────
        if timestamps:
            last_ts = timestamps[0]
            if isinstance(last_ts, datetime):
                time_since_last = max((timestamp - last_ts).total_seconds(), 0)
            else:
                time_since_last = 0.0
        else:
            time_since_last = 0.0

        # velocity = tx in last 60 s
        recent_count = sum(
            1
            for ts in timestamps
            if isinstance(ts, datetime)
            and (timestamp - ts).total_seconds() <= settings.VELOCITY_WINDOW_SEC
        )
        velocity_score = min(recent_count / max(settings.BURST_TX_THRESHOLD, 1), 1.0)

        # night-time flag
        hour = timestamp.hour
        night_flag = hour >= settings.NIGHT_START_HOUR or hour <= settings.NIGHT_END_HOUR

        # ── geo features ─────────────────────────────────────
        geo_distance = 0.0
        impossible_travel = False
        last_lat = profile.get("last_lat")
        last_lon = profile.get("last_lon")
        if sender_lat and sender_lon and last_lat and last_lon:
            geo_distance = _haversine_km(last_lat, last_lon, sender_lat, sender_lon)
            if time_since_last > 0:
                speed_kmh = geo_distance / (time_since_last / 3600)
                impossible_travel = speed_kmh > settings.IMPOSSIBLE_TRAVEL_KMH

        # ── IQR outlier detection (replaces Mahalanobis) ─────
        iqr_outlier_flag = False
        if len(amounts) >= 4:
            iqr_outlier_flag = iqr_outlier(amount, amounts)

        # ── NEW: IP rotation (unique IPs in 24h window) ──────
        ip_rotation_count = 0
        ip_rotation_flag = False
        try:
            ip_rows = await self.neo4j.read_async(
                QUERY_IP_ROTATION, {"user_id": sender_id}
            )
            if ip_rows:
                ip_rotation_count = ip_rows[0].get("unique_ip_count", 0) or 0
                ip_rotation_flag = ip_rotation_count >= settings.IP_ROTATION_MAX_UNIQUE
        except Exception:  # noqa: BLE001
            pass

        # ── NEW: Fixed-amount pattern detection ──────────────
        fixed_amount_flag = False
        try:
            recent_amt_rows = await self.neo4j.read_async(
                QUERY_RECENT_AMOUNTS,
                {"user_id": sender_id, "window_hours": settings.IP_ROTATION_WINDOW_HOURS},
            )
            recent_amts = [r["amount"] for r in recent_amt_rows if r.get("amount")]
            fixed_amount_flag = _detect_fixed_amount_pattern(
                recent_amts, amount,
                settings.FIXED_AMOUNT_TOLERANCE,
                settings.FIXED_AMOUNT_MIN_COUNT,
            )
        except Exception:  # noqa: BLE001
            pass

        # ── NEW: Circadian anomaly (unusual hour for user) ───
        circadian_anomaly = False
        circadian_score = 0.0
        try:
            hour_rows = await self.neo4j.read_async(
                QUERY_USER_HOUR_DISTRIBUTION, {"user_id": sender_id}
            )
            if hour_rows and len(hour_rows) >= 3:
                hour_counts = {r["hour"]: r["cnt"] for r in hour_rows}
                total_tx = sum(hour_counts.values())
                current_hour_count = hour_counts.get(hour, 0)
                # If this hour has <2% of user's total transactions, it's unusual
                if total_tx >= 10 and current_hour_count / total_tx < 0.02:
                    circadian_anomaly = True
                    circadian_score = (
                        settings.CIRCADIAN_NEW_DEVICE_PENALTY if is_new_device
                        else settings.CIRCADIAN_ANOMALY_PENALTY
                    )
        except Exception:  # noqa: BLE001
            pass

        # ── NEW: Transaction identicality index ───────────
        tx_identicality_flag = False
        tx_identicality_count = 0
        if receiver_id:
            try:
                ident_rows = await self.neo4j.read_async(
                    QUERY_IDENTICAL_TX_RECEIVER,
                    {
                        "sender_id": sender_id,
                        "receiver_id": receiver_id,
                        "amount": amount,
                        "window_hours": settings.TX_IDENTICALITY_WINDOW_HOURS,
                    },
                )
                if ident_rows:
                    tx_identicality_count = ident_rows[0].get("identical_count", 0) or 0
                    tx_identicality_flag = tx_identicality_count >= settings.TX_IDENTICALITY_MIN_COUNT
            except Exception:  # noqa: BLE001
                pass

        # ── fuse into 0–100 risk ─────────────────────────────
        risk = 0.0
        risk += min(abs(amount_zscore) * 10, 30)          # up to 30
        risk += velocity_score * 20                        # up to 20
        risk += (1.0 if impossible_travel else 0.0) * 20   # 0 or 20
        risk += (1.0 if night_flag else 0.0) * 5           # 0 or 5
        risk += (1.0 if iqr_outlier_flag else 0.0) * 15    # 0 or 15 (replaces Mahalanobis)
        risk += (1.0 if spike else 0.0) * 10               # 0 or 10
        risk += (1.0 if dormant_burst else 0.0) * 15       # 0 or 15
        risk += asn_risk_scaled                             # 0–20
        risk += (settings.IP_ROTATION_PENALTY if ip_rotation_flag else 0.0)  # 0 or 15
        risk += (settings.FIXED_AMOUNT_PENALTY if fixed_amount_flag else 0.0)  # 0 or 10
        risk += circadian_score                             # 0 or 20/35
        risk += (settings.TX_IDENTICALITY_PENALTY if tx_identicality_flag else 0.0)  # 0 or 30
        risk = min(risk, 100.0)

        flags = []
        if spike:
            flags.append(f"Amount spike: {amount_zscore:.1f}σ above baseline")
        if dormant_burst:
            flags.append("Dormant Burst: tx amount exceeds historical avg")
        if impossible_travel:
            flags.append(f"Impossible travel: {geo_distance:.0f}km")
        if night_flag:
            flags.append("Night-time transaction")
        if asn_result.get("asn_risk", 0) >= 0.5:
            flags.append(f"ASN Risk ({asn_result.get('asn_class', 'UNKNOWN')}): score={asn_result['asn_risk']:.2f}")
        if asn_result.get("foreign_flag"):
            flags.append(f"Foreign IP: {asn_result.get('org_name', '?')} ({asn_result.get('country', '?')})")
        if asn_result.get("asn_drift"):
            flags.append("ASN Drift: IP network differs from user's usual pattern")
        if ip_rotation_flag:
            flags.append(f"IP Rotation: {ip_rotation_count} unique IPs in 24h")
        if fixed_amount_flag:
            flags.append(f"Fixed Amount Pattern: repeated ₹{amount:.2f} transfers")
        if circadian_anomaly:
            flags.append(f"Circadian Anomaly: tx at hour {hour} is unusual for user")
        if tx_identicality_flag:
            flags.append(
                f"TX Identicality: {tx_identicality_count} identical amount "
                f"transfers to same receiver in {settings.TX_IDENTICALITY_WINDOW_HOURS}h"
            )

        features = {
            "amount_zscore": round(amount_zscore, 4),
            "rolling_mean": round(rolling_mean, 2),
            "rolling_std": round(rolling_std, 2),
            "time_since_last_tx": round(time_since_last, 2),
            "velocity_score": round(velocity_score, 4),
            "geo_distance_km": round(geo_distance, 2),
            "impossible_travel": impossible_travel,
            "is_night": night_flag,
            "spike_flag": spike,
            "dormant_burst": dormant_burst,
            "iqr_outlier_flag": iqr_outlier_flag,
            "ip_risk_score": round(asn_risk_scaled, 2),
            "asn_risk": asn_result.get("asn_risk", 0.0),
            "asn_risk_scaled": round(asn_risk_scaled, 2),
            "asn_class": asn_result.get("asn_class", "UNKNOWN"),
            "asn_country": asn_result.get("country", ""),
            "foreign_flag": asn_result.get("foreign_flag", 0),
            "asn_drift": asn_result.get("asn_drift", 0),
            "asn_entropy": asn_result.get("asn_entropy", 0.0),
            "asn_density": asn_result.get("asn_density", 0.0),
            "asn_base": asn_result.get("asn_base", 0.0),
            "ip_rotation_count": ip_rotation_count,
            "ip_rotation_flag": ip_rotation_flag,
            "fixed_amount_flag": fixed_amount_flag,
            "circadian_anomaly": circadian_anomaly,
            "circadian_score": round(circadian_score, 2),
            "tx_identicality_flag": tx_identicality_flag,
            "tx_identicality_count": tx_identicality_count,
            "risk": round(risk, 2),
            "flags": flags,
        }
        return features
