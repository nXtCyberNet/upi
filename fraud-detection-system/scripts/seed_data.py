#!/usr/bin/env python3
"""
seed_data.py – Populate Neo4j with 20 realistic UPI users, devices,
and ~200 baseline transactions.

Fraud rate: ~5% (10 out of 200 transactions are suspicious).
The remaining 190 are normal peer-to-peer UPI payments.

Usage:
    python scripts/seed_data.py                 # from project root
    python scripts/seed_data.py --clear         # wipe DB first (recommended)
"""

import sys
import os
import argparse
import random
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from neo4j import GraphDatabase
from app.config import settings
from app.utils.cypher_queries import (
    SCHEMA_CONSTRAINTS,
    SCHEMA_INDEXES,
    MAINT_CLEAR_ALL,
    MAINT_COUNT_NODES,
)

# ═══════════════════════════════════════════════════════════════
#  Realistic User Profiles (20 users)
# ═══════════════════════════════════════════════════════════════

USERS = [
    # id, name, upi_id, city, lat, lon, avg_tx_amount, is_mule, is_dormant
    ("U0001", "Rajesh Kumar",      "rajesh.kumar@okaxis",       "Mumbai",    19.0760, 72.8777, 1200.0,  False, False),
    ("U0002", "Priya Sharma",      "priya.sharma@okhdfcbank",   "Delhi",     28.7041, 77.1025, 800.0,   False, False),
    ("U0003", "Amit Patel",        "amit.patel@oksbi",          "Ahmedabad", 23.0225, 72.5714, 2500.0,  False, False),
    ("U0004", "Sneha Reddy",       "sneha.reddy@okicici",       "Hyderabad", 17.3850, 78.4867, 600.0,   False, False),
    ("U0005", "Vikram Singh",      "vikram.singh@paytm",        "Jaipur",    26.9124, 75.7873, 3500.0,  False, False),
    ("U0006", "Ananya Iyer",       "ananya.iyer@okaxis",        "Chennai",   13.0827, 80.2707, 450.0,   False, False),
    ("U0007", "Mohammed Farooq",   "md.farooq@okhdfcbank",      "Bangalore", 12.9716, 77.5946, 1800.0,  False, False),
    ("U0008", "Kavitha Nair",      "kavitha.nair@oksbi",        "Kochi",     9.9312,  76.2673, 950.0,   False, False),
    ("U0009", "Rohit Joshi",       "rohit.joshi@okicici",       "Pune",      18.5204, 73.8567, 1500.0,  False, False),
    ("U0010", "Deepa Menon",       "deepa.menon@paytm",         "Kolkata",   22.5726, 88.3639, 700.0,   False, False),
    ("U0011", "Suresh Babu",       "suresh.babu@okaxis",        "Coimbatore",11.0168, 76.9558, 2000.0,  False, False),
    ("U0012", "Meera Deshmukh",    "meera.d@okhdfcbank",        "Nagpur",    21.1458, 79.0882, 1100.0,  False, False),
    ("U0013", "Arjun Malhotra",    "arjun.m@oksbi",             "Chandigarh",30.7333, 76.7794, 4000.0,  False, False),
    ("U0014", "Lakshmi Sundaram",  "lakshmi.s@okicici",         "Madurai",   9.9252,  78.1198, 550.0,   False, False),
    ("U0015", "Nikhil Verma",      "nikhil.v@paytm",            "Lucknow",   26.8467, 80.9462, 1600.0,  False, False),
    # ── Suspicious profiles (3 potential mules / bad actors) ──
    ("U0016", "Rahul X",           "rahulx99@okaxis",           "Mumbai",    19.0760, 72.8777, 500.0,   True,  False),
    ("U0017", "Sanjay Ghost",      "sanjay.g77@paytm",          "Delhi",     28.7041, 77.1025, 300.0,   True,  False),
    ("U0018", "Fake Vendor",       "vendor.pay@okaxis",         "Bangalore", 12.9716, 77.5946, 200.0,   True,  False),
    # ── Dormant accounts ──
    ("U0019", "Pooja Kapoor",      "pooja.k@okhdfcbank",        "Indore",    22.7196, 75.8577, 900.0,   False, True),
    ("U0020", "Ravi Shankar",      "ravi.shankar@oksbi",        "Patna",     25.6093, 85.1376, 750.0,   False, True),
]

# ═══════════════════════════════════════════════════════════════
#  Realistic Device Profiles (15 devices)
# ═══════════════════════════════════════════════════════════════

DEVICES = [
    # id, os, type, app_version, cap_mask
    ("DEV0001", "Android 14",  "ANDROID", "3.2.1", "111001"),
    ("DEV0002", "Android 13",  "ANDROID", "3.1.0", "011001"),
    ("DEV0003", "iOS 17",      "IOS",     "3.2.1", "111111"),
    ("DEV0004", "Android 14",  "ANDROID", "3.2.1", "011101"),
    ("DEV0005", "iOS 16",      "IOS",     "3.1.0", "111001"),
    ("DEV0006", "Android 13",  "ANDROID", "3.0.0", "011001"),
    ("DEV0007", "Android 14",  "ANDROID", "3.2.1", "111001"),
    ("DEV0008", "iOS 17",      "IOS",     "3.2.1", "111111"),
    ("DEV0009", "Android 12",  "ANDROID", "2.9.5", "010001"),
    ("DEV0010", "Android 14",  "ANDROID", "3.2.1", "011001"),
    ("DEV0011", "Android 13",  "ANDROID", "3.1.0", "011001"),
    ("DEV0012", "iOS 16",      "IOS",     "3.0.0", "111001"),
    ("DEV0013", "Android 14",  "ANDROID", "3.2.1", "111001"),
    ("DEV0014", "Android 13",  "ANDROID", "3.1.0", "011001"),
    # ── Shared suspicious device (used by mule accounts) ──
    ("DEV0015", "Android 12",  "ANDROID", "2.8.0", "010001"),
]

# User -> Device mapping (1:1 for legit, shared DEV0015 for mules)
USER_DEVICE_MAP = {
    "U0001": "DEV0001", "U0002": "DEV0002", "U0003": "DEV0003",
    "U0004": "DEV0004", "U0005": "DEV0005", "U0006": "DEV0006",
    "U0007": "DEV0007", "U0008": "DEV0008", "U0009": "DEV0009",
    "U0010": "DEV0010", "U0011": "DEV0011", "U0012": "DEV0012",
    "U0013": "DEV0013", "U0014": "DEV0014", "U0015": "DEV0012",
    # Mules share the same device (suspicious signal)
    "U0016": "DEV0015", "U0017": "DEV0015", "U0018": "DEV0015",
    # Dormant users
    "U0019": "DEV0011", "U0020": "DEV0014",
}


def _generate_normal_transactions(now):
    """
    Generate ~190 normal, realistic UPI transactions.
    Amounts based on each user's avg with natural variance.
    Timestamps spread over last 30 days during normal hours (8AM-10PM).
    """
    legit_users = [u for u in USERS if not u[7] and not u[8]]
    txns = []

    for _ in range(190):
        sender = random.choice(legit_users)
        receiver = random.choice(legit_users)
        while receiver[0] == sender[0]:
            receiver = random.choice(legit_users)

        avg = sender[6]
        amount = max(50, min(avg * 2.5, random.gauss(avg, avg * 0.35)))
        amount = round(amount, 2)

        days_ago = random.randint(0, 30)
        hour = random.randint(8, 21)
        minute = random.randint(0, 59)
        ts = now - timedelta(days=days_ago)
        ts = ts.replace(hour=hour, minute=minute, second=random.randint(0, 59))

        txns.append({
            "tx_id": str(uuid.uuid4()),
            "sender": sender[0],
            "receiver": receiver[0],
            "amount": amount,
            "timestamp": ts.isoformat(),
            "risk_score": round(random.uniform(2.0, 18.0), 2),
            "status": "COMPLETED",
            "channel": "UPI",
        })

    return txns


def _generate_fraudulent_transactions(now):
    """
    Generate exactly 10 suspicious transactions (~5% of 200).
    These mimic real fraud patterns the risk engine should catch.
    """
    txns = []
    mule_ids = ["U0016", "U0017", "U0018"]
    dormant_ids = ["U0019", "U0020"]
    legit_users = [u for u in USERS if not u[7] and not u[8]]

    # -- Pattern 1: Mule ring (3 txns) circular A->B->C->A --
    ring_amount = round(random.uniform(45000, 75000), 2)
    ring_ts = now - timedelta(hours=random.randint(1, 6))
    for i, (s, r) in enumerate([
        ("U0016", "U0017"), ("U0017", "U0018"), ("U0018", "U0016")
    ]):
        txns.append({
            "tx_id": str(uuid.uuid4()),
            "sender": s, "receiver": r,
            "amount": ring_amount + random.uniform(-500, 500),
            "timestamp": (ring_ts + timedelta(minutes=i * 3)).isoformat(),
            "risk_score": round(random.uniform(65.0, 88.0), 2),
            "status": "FLAGGED",
            "channel": "UPI",
        })

    # -- Pattern 2: Dormant activation (2 txns) --
    for dormant_id in dormant_ids:
        receiver = random.choice(legit_users)
        txns.append({
            "tx_id": str(uuid.uuid4()),
            "sender": dormant_id, "receiver": receiver[0],
            "amount": round(random.uniform(25000, 60000), 2),
            "timestamp": (now - timedelta(hours=random.randint(1, 12))).isoformat(),
            "risk_score": round(random.uniform(55.0, 78.0), 2),
            "status": "FLAGGED",
            "channel": "UPI",
        })

    # -- Pattern 3: Structuring / identical amounts (3 txns) --
    struct_sender = random.choice(mule_ids)
    struct_amount = random.choice([4999.0, 9999.0, 7500.0])
    struct_receiver = random.choice(legit_users)
    for i in range(3):
        txns.append({
            "tx_id": str(uuid.uuid4()),
            "sender": struct_sender, "receiver": struct_receiver[0],
            "amount": struct_amount,
            "timestamp": (now - timedelta(hours=2, minutes=i * 5)).isoformat(),
            "risk_score": round(random.uniform(50.0, 72.0), 2),
            "status": "FLAGGED",
            "channel": "UPI",
        })

    # -- Pattern 4: Rapid pass-through (2 txns) --
    passthrough_ts = now - timedelta(hours=random.randint(2, 8))
    legit_sender = random.choice(legit_users)
    txns.append({
        "tx_id": str(uuid.uuid4()),
        "sender": legit_sender[0], "receiver": "U0016",
        "amount": round(random.uniform(30000, 50000), 2),
        "timestamp": passthrough_ts.isoformat(),
        "risk_score": round(random.uniform(35.0, 52.0), 2),
        "status": "COMPLETED",
        "channel": "UPI",
    })
    final_receiver = random.choice(legit_users)
    txns.append({
        "tx_id": str(uuid.uuid4()),
        "sender": "U0016", "receiver": final_receiver[0],
        "amount": round(random.uniform(28000, 48000), 2),
        "timestamp": (passthrough_ts + timedelta(minutes=2)).isoformat(),
        "risk_score": round(random.uniform(58.0, 80.0), 2),
        "status": "FLAGGED",
        "channel": "UPI",
    })

    return txns


def _flush_batch(session, batch):
    """Insert a batch of transactions via UNWIND."""
    session.run(
        """
        UNWIND $rows AS row
        MATCH (s:User {user_id: row.sender})
        MATCH (r:User {user_id: row.receiver})
        CREATE (tx:Transaction {
            tx_id:      row.tx_id,
            amount:     row.amount,
            timestamp:  datetime(row.timestamp),
            channel:    row.channel,
            status:     row.status,
            risk_score: row.risk_score
        })
        CREATE (s)-[:SENT]->(tx)-[:RECEIVED_BY]->(r)
        MERGE (s)-[edge:TRANSFERRED_TO]->(r)
          ON CREATE SET edge.total_amount = row.amount,
                        edge.tx_count    = 1,
                        edge.last_tx     = datetime(row.timestamp)
          ON MATCH  SET edge.total_amount = edge.total_amount + row.amount,
                        edge.tx_count    = edge.tx_count + 1,
                        edge.last_tx     = datetime(row.timestamp)
        SET s.last_active = datetime(row.timestamp),
            s.tx_count    = coalesce(s.tx_count, 0) + 1,
            s.total_outflow = coalesce(s.total_outflow, 0) + row.amount
        """,
        {"rows": batch},
    )
    print(f"   ... flushed {len(batch)} transactions")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--clear", action="store_true", help="Clear DB before seeding")
    args = parser.parse_args()

    print(f"Connecting to Neo4j at {settings.NEO4J_URI} ...")
    driver = GraphDatabase.driver(
        settings.NEO4J_URI,
        auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
    )
    driver.verify_connectivity()
    print("Connected\n")

    now = datetime.now(timezone.utc)

    with driver.session(database=settings.NEO4J_DATABASE) as session:

        if args.clear:
            print("Clearing ALL data from database ...")
            session.run(MAINT_CLEAR_ALL)
            print("   Done\n")

        print("Ensuring schema constraints & indexes ...")
        for stmt in SCHEMA_CONSTRAINTS + SCHEMA_INDEXES:
            try:
                session.run(stmt)
            except Exception:
                pass
        print("   Done\n")

        # -- Users (20) --
        print(f"Creating {len(USERS)} users ...")
        for uid, name, upi_id, city, lat, lon, avg_amt, is_mule, is_dormant in USERS:
            created = now - timedelta(days=random.randint(90, 365))
            if is_dormant:
                last_active = now - timedelta(days=random.randint(35, 90))
            else:
                last_active = now - timedelta(minutes=random.randint(5, 1440))

            session.run(
                """
                MERGE (u:User {user_id: $uid})
                SET u.name          = $name,
                    u.upi_id        = $upi_id,
                    u.city          = $city,
                    u.created_at    = datetime($created),
                    u.last_active   = datetime($last_active),
                    u.is_dormant    = $dormant,
                    u.risk_score    = 0.0,
                    u.tx_count      = 0,
                    u.total_outflow = 0.0,
                    u.avg_tx_amount = $avg_amt,
                    u.std_tx_amount = 0.0,
                    u.last_lat      = $lat,
                    u.last_lon      = $lon,
                    u.kyc_status    = 'VERIFIED',
                    u.is_mule_label = $is_mule
                """,
                {
                    "uid": uid, "name": name, "upi_id": upi_id, "city": city,
                    "created": created.isoformat(),
                    "last_active": last_active.isoformat(),
                    "dormant": is_dormant,
                    "avg_amt": avg_amt,
                    "lat": lat + random.uniform(-0.02, 0.02),
                    "lon": lon + random.uniform(-0.02, 0.02),
                    "is_mule": is_mule,
                },
            )
        print(f"   {len(USERS)} users created\n")

        # -- Devices (15) --
        print(f"Creating {len(DEVICES)} devices ...")
        for dev_id, dev_os, dev_type, app_ver, cap_mask in DEVICES:
            session.run(
                """
                MERGE (d:Device {device_id: $dev_id})
                SET d.os              = $os,
                    d.device_type     = $device_type,
                    d.app_version     = $app_version,
                    d.capability_mask = $cap_mask,
                    d.device_score    = 0.0,
                    d.account_count   = 0,
                    d.created_at      = datetime()
                """,
                {
                    "dev_id": dev_id, "os": dev_os,
                    "device_type": dev_type, "app_version": app_ver,
                    "cap_mask": cap_mask,
                },
            )
        print(f"   {len(DEVICES)} devices created\n")

        # -- Link users to devices --
        print("Linking users to devices ...")
        for uid, dev_id in USER_DEVICE_MAP.items():
            session.run(
                """
                MATCH (u:User {user_id: $uid}), (d:Device {device_id: $dev})
                MERGE (u)-[:USES_DEVICE]->(d)
                """,
                {"uid": uid, "dev": dev_id},
            )
        shared_count = sum(1 for d in USER_DEVICE_MAP.values() if d == "DEV0015")
        print(f"   Shared device DEV0015 linked to {shared_count} mule accounts")
        print(f"   All user-device links created\n")

        # -- Generate transactions --
        print("Generating transactions ...")
        normal_txns = _generate_normal_transactions(now)
        fraud_txns = _generate_fraudulent_transactions(now)

        all_txns = normal_txns + fraud_txns
        random.shuffle(all_txns)

        total = len(all_txns)
        fraud_count = len(fraud_txns)
        normal_count = len(normal_txns)
        print(f"   Normal: {normal_count}  |  Suspicious: {fraud_count}  |  Total: {total}")
        print(f"   Fraud rate: {fraud_count / total * 100:.1f}%\n")

        _flush_batch(session, all_txns)

        # -- Update user risk scores for mule/dormant accounts --
        print("\nSetting risk scores on suspicious users ...")
        for uid in ["U0016", "U0017", "U0018"]:
            session.run(
                "MATCH (u:User {user_id: $uid}) SET u.risk_score = $risk",
                {"uid": uid, "risk": round(random.uniform(62.0, 85.0), 2)},
            )
            print(f"   {uid} -> risk set (mule)")

        for uid in ["U0019", "U0020"]:
            session.run(
                "MATCH (u:User {user_id: $uid}) SET u.risk_score = $risk",
                {"uid": uid, "risk": round(random.uniform(48.0, 68.0), 2)},
            )
            print(f"   {uid} -> risk set (dormant activation)")

        # -- Final counts --
        print("\nFinal node counts:")
        for row in session.run(MAINT_COUNT_NODES):
            r = row.data()
            print(f"   {r['label']}: {r['count']}")

    driver.close()
    print(f"\nSeed data complete!")
    print(f"   {len(USERS)} users, {len(DEVICES)} devices, {total} transactions")
    print(f"   Fraud rate: {fraud_count}/{total} = {fraud_count/total*100:.1f}%")


if __name__ == "__main__":
    main()
