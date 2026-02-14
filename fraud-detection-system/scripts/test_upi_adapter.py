#!/usr/bin/env python3
"""Quick test: UPI adapter endpoint + verify response field names."""
import json
import urllib.request

BASE = "http://localhost:8000/api"

# Test 1: UPI adapter single ingest
print("=" * 60)
print("TEST 1: POST /api/upi/ingest (flat UPI payload)")
print("=" * 60)
payload = {
    "transaction_id": "test-upi-001",
    "timestamp": "2024-06-22 04:06:38",
    "sender_name": "Tiya Mall",
    "sender_upi_id": "4161803452@okaxis",
    "receiver_name": "Mohanlal Golla",
    "receiver_upi_id": "7776849307@okybl",
    "amount": 3907.34,
    "status": "SUCCESS",
}
req = urllib.request.Request(
    f"{BASE}/upi/ingest",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    print(f"  Status: {resp.status}")
    print(f"  Response: {json.dumps(data, indent=2)}")
    print(f"  ✅ UPI ingest accepted={data['accepted']}")
except Exception as e:
    print(f"  ❌ Error: {e}")

# Test 2: Check /stream/recent response field names
print()
print("=" * 60)
print("TEST 2: GET /api/stream/recent (verify field names)")
print("=" * 60)
import time
time.sleep(3)  # wait for worker to process

req2 = urllib.request.Request(f"{BASE}/stream/recent?limit=5")
try:
    resp2 = urllib.request.urlopen(req2)
    data2 = json.loads(resp2.read())
    txs = data2.get("transactions", [])
    print(f"  Got {len(txs)} transactions")
    if txs:
        tx = txs[0]
        print(f"  First tx keys: {sorted(tx.keys())}")
        print(f"  senderUPI present? {'senderUPI' in tx}")
        print(f"  receiverUPI present? {'receiverUPI' in tx}")
        print(f"  senderIP present? {'senderIP' in tx}")
        print(f"  senderUpi (wrong)? {'senderUpi' in tx}")
        print(f"  Sample: id={tx.get('id')}, senderUPI={tx.get('senderUPI')}, receiverUPI={tx.get('receiverUPI')}, amount={tx.get('amount')}")
        print(f"  ✅ Field names correct!" if 'senderUPI' in tx else "  ❌ senderUPI missing!")
except Exception as e:
    print(f"  ❌ Error: {e}")

# Test 3: Health endpoint
print()
print("=" * 60)
print("TEST 3: GET /api/system/health")
print("=" * 60)
req3 = urllib.request.Request(f"{BASE}/system/health")
try:
    resp3 = urllib.request.urlopen(req3)
    data3 = json.loads(resp3.read())
    print(f"  TPS: {data3.get('tps')}")
    print(f"  Uptime: {data3.get('uptime')}")
    workers = data3.get("workers", {})
    print(f"  CPU: {workers.get('cpuPercent')}%, RAM: {workers.get('ramPercent')}%")
    print(f"  ✅ Health OK")
except Exception as e:
    print(f"  ❌ Error: {e}")

print()
print("Done!")
