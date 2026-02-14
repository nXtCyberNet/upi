"""
Transaction simulator (v3).

Generates realistic-looking UPI transactions using the v2 nested schema
at a configurable TPS rate and pushes them onto the Redis stream for
the worker pool to consume.

Includes built-in fraud scenarios so the detection engine has something
to catch:
  • Mule rings           (circular A→B→C→A transfers)
  • Dormant activation   (sleeping accounts suddenly active)
  • Device-sharing       (one device, many accounts)
  • Rapid pass-through   (receive then immediately send)
  • SIM-swap attack      (one device, many sender_ids in 24h)
  • New device + high amount + MPIN  (suspicious combo)
  • Circadian anomaly    (tx at 3 AM from merchant account)
  • TX identicality      (same amount × N to same receiver)
  • Sleep-and-flash mule (dormant >30d, ratio >50x)
  • Normal traffic       (baseline)
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import redis.asyncio as aioredis

from app.config import settings
from app.streaming.redis_stream import publish_transaction

logger = logging.getLogger(__name__)

# ── deterministic user / device pools ────────────────────────

_CITIES = [
    ("Mumbai", 19.076, 72.8777),
    ("Delhi", 28.7041, 77.1025),
    ("Bangalore", 12.9716, 77.5946),
    ("Hyderabad", 17.385, 78.4867),
    ("Chennai", 13.0827, 80.2707),
    ("Kolkata", 22.5726, 88.3639),
    ("Pune", 18.5204, 73.8567),
    ("Jaipur", 26.9124, 75.7873),
]

_OS_OPTIONS = ["Android 13", "Android 14", "iOS 17", "iOS 16", "Android 12"]
_DEVICE_TYPES = ["ANDROID", "ANDROID", "ANDROID", "IOS", "IOS"]  # weighted
_APP_VERSIONS = ["3.2.1", "3.1.0", "3.0.0", "2.9.5", "2.8.0"]
_CAPABILITY_MASKS = ["011001", "111001", "011101", "111111", "010001"]
_CREDENTIAL_TYPES = ["PIN", "OTP", "BIOMETRIC"]
_CREDENTIAL_SUBS = {"PIN": "MPIN", "OTP": "SMS_OTP", "BIOMETRIC": "FINGERPRINT"}
_RECEIVER_TYPES = ["PERSON", "PERSON", "PERSON", "MERCHANT", "BILLER"]

_ASN_TYPES = ["MOBILE_ISP", "BROADBAND", "INDIAN_CLOUD", "FOREIGN"]


def _random_ip(asn_hint: str) -> str:
    """Generate a public IPv4 address.  Actual ASN resolved from MMDB at ingestion."""
    if asn_hint == "INDIAN_CLOUD":
        return f"3.{random.choice([6, 7, 108])}.{random.randint(0, 255)}.{random.randint(1, 254)}"
    if asn_hint == "FOREIGN":
        return f"8.8.{random.randint(0, 8)}.{random.randint(1, 254)}"
    if asn_hint == "MOBILE_ISP":
        return f"49.{random.randint(32, 47)}.{random.randint(0, 255)}.{random.randint(1, 254)}"
    return f"59.{random.randint(88, 95)}.{random.randint(0, 255)}.{random.randint(1, 254)}"


def _generate_users(n: int) -> List[Dict[str, Any]]:
    users = []
    for i in range(1, n + 1):          # 1-indexed to match seed_data (U0001..U0020)
        city, lat, lon = random.choice(_CITIES)
        users.append({
            "user_id": f"U{i:04d}",
            "upi_id": f"user{i}@upi",
            "city": city,
            "lat": lat + random.uniform(-0.05, 0.05),
            "lon": lon + random.uniform(-0.05, 0.05),
            "avg_amount": random.uniform(200, 5000),
        })
    return users


def _generate_devices(n: int) -> List[Dict[str, Any]]:
    devices = []
    for i in range(1, n + 1):          # 1-indexed to match seed_data (DEV0001..DEV0015)
        dtype = random.choice(_DEVICE_TYPES)
        devices.append({
            "device_id": f"DEV{i:04d}",
            "device_os": random.choice(_OS_OPTIONS),
            "device_type": dtype,
            "app_version": random.choice(_APP_VERSIONS[:3]),  # mostly recent
            "capability_mask": random.choice(_CAPABILITY_MASKS),
        })
    return devices


class TransactionSimulator:
    """Push simulated transactions onto the Redis stream (v3 schema)."""
    def __init__(self, redis_client: aioredis.Redis) -> None:
        self.redis = redis_client
        self.users = _generate_users(settings.SIMULATION_USER_COUNT)
        self.devices = _generate_devices(settings.SIMULATION_DEVICE_COUNT)

        # Mules match seed_data: U0016, U0017, U0018
        self.mule_ids = {u["user_id"] for u in self.users if u["user_id"] in ("U0016", "U0017", "U0018")}

        # shared devices (mules share DEV0015 in seed_data)
        self.shared_device = "DEV0015"

        # dormant accounts match seed_data: U0019, U0020
        self.dormant_ids = {u["user_id"] for u in self.users if u["user_id"] in ("U0019", "U0020")}

        self._stop = False
        self.sent_count = 0

    # ── public API ───────────────────────────────────────────

    async def run(
        self,
        total_tx: int | None = None,
        tps: int | None = None,
    ) -> int:
        """
        Generate and publish transactions.
        Returns the number of transactions sent.
        """
        total_tx = total_tx or settings.SIMULATION_TOTAL_TX
        tps = tps or settings.SIMULATION_TPS
        delay = 1.0 / tps if tps > 0 else 0.002
        self.sent_count = 0
        self._stop = False

        logger.info("🚀 Simulator started: %d tx at %d TPS", total_tx, tps)
        t0 = time.time()

        for i in range(total_tx):
            if self._stop:
                break

            # Choose scenario
            roll = random.random()
            if roll < 0.05:
                tx = self._make_mule_ring_tx()
            elif roll < 0.10:
                tx = self._make_dormant_activation_tx()
            elif roll < 0.15:
                tx = self._make_shared_device_tx()
            elif roll < 0.20:
                tx = self._make_rapid_passthrough_tx()
            elif roll < 0.24:
                tx = self._make_sim_swap_tx()
            elif roll < 0.28:
                tx = self._make_new_device_high_mpin_tx()
            elif roll < 0.32:
                tx = self._make_circadian_anomaly_tx()
            elif roll < 0.36:
                tx = self._make_identicality_tx()
            elif roll < 0.40:
                tx = self._make_sleep_flash_tx()
            else:
                tx = self._make_normal_tx()

            await publish_transaction(self.redis, tx)
            self.sent_count += 1

            # throttle to target TPS
            if i % 50 == 0:
                elapsed = time.time() - t0
                expected = (i + 1) * delay
                if elapsed < expected:
                    await asyncio.sleep(expected - elapsed)

        elapsed = time.time() - t0
        actual_tps = self.sent_count / max(elapsed, 0.01)
        logger.info(
            "✅ Simulator done: %d tx in %.1fs (%.0f TPS)",
            self.sent_count, elapsed, actual_tps,
        )
        return self.sent_count

    def stop(self) -> None:
        self._stop = True

    # ── scenario generators ──────────────────────────────────

    def _base_tx(self, sender: Dict, receiver: Dict, amount: float, device_id: str) -> Dict:
        """Build a v2 nested transaction dict."""
        device = next((d for d in self.devices if d["device_id"] == device_id), None)
        asn_type = random.choices(_ASN_TYPES, weights=[0.50, 0.30, 0.10, 0.10], k=1)[0]

        cred_type = random.choice(_CREDENTIAL_TYPES)
        recv_type = random.choice(_RECEIVER_TYPES)

        return {
            "tx_id": str(uuid.uuid4()),
            "timestamp": datetime.utcnow().isoformat(),
            "amount": round(amount, 2),
            "currency": "INR",
            "txn_type": "PAY",
            "sender": {
                "sender_id": sender["user_id"],
                "upi_id": sender["upi_id"],
                "device": {
                    "device_id": device_id,
                    "device_os": device.get("device_os") if device else "Android 14",
                    "device_type": device.get("device_type") if device else "ANDROID",
                    "app_version": device.get("app_version") if device else "3.2.1",
                    "capability_mask": device.get("capability_mask") if device else "011001",
                },
                "network": {
                    "ip_address": _random_ip(asn_type),
                },
                "geo": {
                    "lat": sender["lat"],
                    "lon": sender["lon"],
                },
            },
            "credential": {
                "type": cred_type,
                "sub_type": _CREDENTIAL_SUBS.get(cred_type, "MPIN"),
            },
            "receiver": {
                "receiver_id": receiver["user_id"],
                "upi_id": receiver["upi_id"],
                "receiver_type": recv_type,
                "mcc_code": f"{random.randint(1000, 9999)}" if recv_type == "MERCHANT" else None,
            },
        }

    def _make_normal_tx(self) -> Dict:
        sender = random.choice(self.users)
        receiver = random.choice(self.users)
        while receiver["user_id"] == sender["user_id"]:
            receiver = random.choice(self.users)
        device = random.choice(self.devices)
        amount = max(random.gauss(sender["avg_amount"], sender["avg_amount"] * 0.3), 10)
        return self._base_tx(sender, receiver, amount, device["device_id"])

    def _make_mule_ring_tx(self) -> Dict:
        """A→B→C ring with mule accounts, high amounts."""
        mule_list = [u for u in self.users if u["user_id"] in self.mule_ids]
        if len(mule_list) < 2:
            return self._make_normal_tx()
        sender, receiver = random.sample(mule_list, 2)
        amount = random.uniform(10000, 50000)
        device = random.choice(self.devices[:5])
        return self._base_tx(sender, receiver, amount, device["device_id"])

    def _make_dormant_activation_tx(self) -> Dict:
        """Dormant account suddenly sends large tx."""
        dormant_list = [u for u in self.users if u["user_id"] in self.dormant_ids]
        if not dormant_list:
            return self._make_normal_tx()
        sender = random.choice(dormant_list)
        receiver = random.choice(self.users)
        amount = random.uniform(20000, 100000)
        device = random.choice(self.devices)
        return self._base_tx(sender, receiver, amount, device["device_id"])

    def _make_shared_device_tx(self) -> Dict:
        """Multiple users on the same device."""
        sender = random.choice(self.users)
        receiver = random.choice(self.users)
        while receiver["user_id"] == sender["user_id"]:
            receiver = random.choice(self.users)
        amount = random.uniform(500, 15000)
        return self._base_tx(sender, receiver, amount, self.shared_device)

    def _make_rapid_passthrough_tx(self) -> Dict:
        """User who just received money immediately sends it on."""
        mule_list = [u for u in self.users if u["user_id"] in self.mule_ids]
        if not mule_list:
            return self._make_normal_tx()
        sender = random.choice(mule_list)
        receiver = random.choice(self.users)
        amount = random.uniform(5000, 30000)
        device = random.choice(self.devices[:10])
        return self._base_tx(sender, receiver, amount, device["device_id"])

    def _make_sim_swap_tx(self) -> Dict:
        """SIM-swap: many different users transacting from the same device in 24h."""
        sender = random.choice(self.users)
        receiver = random.choice(self.users)
        while receiver["user_id"] == sender["user_id"]:
            receiver = random.choice(self.users)
        amount = random.uniform(3000, 20000)
        # All SIM-swap tx use the shared device — simulates one phone, many SIMs
        return self._base_tx(sender, receiver, amount, self.shared_device)

    def _make_circadian_anomaly_tx(self) -> Dict:
        """Transaction at 2-4 AM from an account that typically transacts 10AM-8PM."""
        # Pick from normal (non-mule, non-dormant) users — "daytime-only" profiles
        legit = [u for u in self.users if u["user_id"] not in self.mule_ids and u["user_id"] not in self.dormant_ids]
        if not legit:
            return self._make_normal_tx()
        sender = random.choice(legit)
        receiver = random.choice(self.users)
        while receiver["user_id"] == sender["user_id"]:
            receiver = random.choice(self.users)
        amount = random.uniform(5000, 50000)
        device = random.choice(self.devices)
        tx = self._base_tx(sender, receiver, amount, device["device_id"])
        # Override timestamp to 2-4 AM
        night_ts = datetime.utcnow().replace(hour=random.randint(2, 4), minute=random.randint(0, 59))
        tx["timestamp"] = night_ts.isoformat()
        return tx

    def _make_identicality_tx(self) -> Dict:
        """Same exact amount to same receiver, repeated 4-6 times."""
        sender = random.choice(self.users)
        receiver = random.choice(self.users)
        while receiver["user_id"] == sender["user_id"]:
            receiver = random.choice(self.users)
        # Pick a round structuring amount (stays under thresholds)
        amount = random.choice([5000.0, 9999.0, 4999.0, 7500.0])
        device = random.choice(self.devices)
        return self._base_tx(sender, receiver, amount, device["device_id"])

    def _make_sleep_flash_tx(self) -> Dict:
        """Dormant >30d account sends amount >50x historical average."""
        dormant_list = [u for u in self.users if u["user_id"] in self.dormant_ids]
        if not dormant_list:
            return self._make_normal_tx()
        sender = random.choice(dormant_list)
        receiver = random.choice(self.users)
        while receiver["user_id"] == sender["user_id"]:
            receiver = random.choice(self.users)
        # Amount is 50-100x their avg (which is typically 200-5000)
        amount = sender["avg_amount"] * random.uniform(50, 100)
        device = random.choice(self.devices)
        return self._base_tx(sender, receiver, amount, device["device_id"])

    def _make_new_device_high_mpin_tx(self) -> Dict:
        """New device + high amount + MPIN credential combo."""
        sender = random.choice(self.users)
        receiver = random.choice(self.users)
        while receiver["user_id"] == sender["user_id"]:
            receiver = random.choice(self.users)
        amount = random.uniform(15000, 80000)
        # Use a fresh device ID never seen before
        new_device_id = f"NEW-{uuid.uuid4().hex[:8]}"
        tx = self._base_tx(sender, receiver, amount, new_device_id)
        # Override with fresh device fields
        tx["sender"]["device"] = {
            "device_id": new_device_id,
            "device_os": "Android 14",
            "device_type": "ANDROID",
            "app_version": "3.2.1",
            "capability_mask": "011001",
        }
        # Force MPIN credential
        tx["credential"] = {"type": "PIN", "sub_type": "MPIN"}
        return tx
