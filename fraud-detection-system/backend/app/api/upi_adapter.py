"""
UPI Server Adapter — translates flat UPI gateway payloads into the
nested TransactionInput schema used by the fraud detection engine.

The real UPI server sends a flat JSON like:
{
  "transaction_id": "...",
  "timestamp": "2024-06-22 04:06:38",
  "sender_name": "Tiya Mall",
  "sender_upi_id": "4161803452@okaxis",
  "receiver_name": "Mohanlal Golla",
  "receiver_upi_id": "7776849307@okybl",
  "amount": 3907.34,
  "status": "SUCCESS"
}

This adapter:
  1. Accepts the flat payload (single or batch)
  2. Enriches with synthetic device/network/geo fields where missing
  3. Transforms into the nested TransactionInput v2 schema
  4. Publishes onto the Redis stream for the worker pool

Endpoints:
  POST /api/upi/ingest       — single transaction
  POST /api/upi/ingest/batch — array of transactions
"""

from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.streaming.redis_stream import publish_transaction

logger = logging.getLogger(__name__)

upi_adapter_router = APIRouter()

# ── dependency pointer (filled in by init_upi_adapter) ──────
_redis = None


def init_upi_adapter(redis_client):
    """Called once at startup to inject Redis dependency."""
    global _redis
    _redis = redis_client


# ═══ Flat UPI Server Model ════════════════════════════════════

class UPITransaction(BaseModel):
    """Flat payload shape from a real UPI gateway / switch."""
    transaction_id: Optional[str] = Field(
        default=None, description="UPI server's transaction ID"
    )
    timestamp: Optional[str] = Field(
        default=None,
        description="ISO or 'YYYY-MM-DD HH:MM:SS' format"
    )
    sender_name: str = ""
    sender_upi_id: str = Field(
        ..., description="e.g. '4161803452@okaxis'"
    )
    receiver_name: str = ""
    receiver_upi_id: str = Field(
        ..., description="e.g. '7776849307@okybl'"
    )
    amount: float = Field(..., gt=0)
    status: str = "SUCCESS"

    # ── Optional enrichment fields (if the UPI server provides them) ──
    sender_ip: Optional[str] = None
    device_id: Optional[str] = None
    device_os: Optional[str] = None
    device_type: Optional[str] = None          # "ANDROID" | "IOS" | "WEB"
    app_version: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    credential_type: Optional[str] = None      # "PIN" | "OTP" | "BIOMETRIC"
    receiver_type: Optional[str] = None        # "PERSON" | "MERCHANT" | "BILLER"
    mcc_code: Optional[str] = None

    class Config:
        populate_by_name = True
        # Accept both snake_case and the CSV header names
        json_schema_extra = {
            "examples": [
                {
                    "transaction_id": "4d3db980-46cd-4158-a812-dcb77055d0d2",
                    "timestamp": "2024-06-22 04:06:38",
                    "sender_name": "Tiya Mall",
                    "sender_upi_id": "4161803452@okaxis",
                    "receiver_name": "Mohanlal Golla",
                    "receiver_upi_id": "7776849307@okybl",
                    "amount": 3907.34,
                    "status": "SUCCESS",
                }
            ]
        }


class UPIBatchRequest(BaseModel):
    """Batch of flat UPI transactions."""
    transactions: List[UPITransaction]


class UPIIngestResponse(BaseModel):
    """Response from the adapter."""
    accepted: int = 0
    failed: int = 0
    errors: List[str] = Field(default_factory=list)
    stream_ids: List[str] = Field(default_factory=list)


# ═══ Transform helpers ════════════════════════════════════════

# Random IP pool for enrichment when UPI server doesn't provide IP
_INDIAN_IP_PREFIXES = [
    "49.{}.{}.{}",     # Jio
    "59.{}.{}.{}",     # BSNL
    "103.{}.{}.{}",    # Indian broadband
    "106.{}.{}.{}",    # Airtel
    "122.{}.{}.{}",    # Vodafone
    "157.{}.{}.{}",    # ACT
]

_DEFAULT_OS_OPTIONS = ["Android 14", "Android 13", "iOS 17", "iOS 16"]
_DEFAULT_DEVICE_TYPES = ["ANDROID", "ANDROID", "ANDROID", "IOS"]
_DEFAULT_APP_VERSIONS = ["3.2.1", "3.1.0", "3.0.0"]

# City lookup by UPI bank handle (rough heuristic)
_CITY_BY_HANDLE: Dict[str, tuple] = {
    "okaxis": ("Mumbai", 19.076, 72.8777),
    "oksbi": ("Delhi", 28.7041, 77.1025),
    "okybl": ("Kolkata", 22.5726, 88.3639),
    "okicici": ("Bangalore", 12.9716, 77.5946),
    "okhdfcbank": ("Hyderabad", 17.385, 78.4867),
    "okkotak": ("Chennai", 13.0827, 80.2707),
    "paytm": ("Pune", 18.5204, 73.8567),
    "gpay": ("Jaipur", 26.9124, 75.7873),
    "phonepe": ("Mumbai", 19.076, 72.8777),
    "ybl": ("Delhi", 28.7041, 77.1025),
}


def _extract_handle(upi_id: str) -> str:
    """Extract bank handle from UPI ID: '4161803452@okaxis' → 'okaxis'"""
    parts = upi_id.split("@")
    return parts[1] if len(parts) > 1 else ""


def _extract_user_id(upi_id: str) -> str:
    """Extract user part from UPI ID: '4161803452@okaxis' → '4161803452'"""
    parts = upi_id.split("@")
    return parts[0] if parts else upi_id


def _random_indian_ip() -> str:
    """Generate a plausible Indian IP address."""
    prefix = random.choice(_INDIAN_IP_PREFIXES)
    return prefix.format(
        random.randint(32, 200),
        random.randint(0, 255),
        random.randint(1, 254),
    )


def _parse_timestamp(ts_str: Optional[str]) -> str:
    """Normalise timestamp to ISO format."""
    if not ts_str:
        return datetime.now(timezone.utc).isoformat()

    # Try common formats
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f",
                "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            dt = datetime.strptime(ts_str.strip(), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except ValueError:
            continue

    # Fall back to current time
    return datetime.now(timezone.utc).isoformat()


def _upi_to_nested(flat: UPITransaction) -> Dict[str, Any]:
    """
    Transform a flat UPI server payload into the nested v2 schema
    expected by TransactionInput / Redis stream / worker pool.
    """
    sender_handle = _extract_handle(flat.sender_upi_id)
    sender_user_id = _extract_user_id(flat.sender_upi_id)
    receiver_user_id = _extract_user_id(flat.receiver_upi_id)

    # Geo heuristic from bank handle
    city_info = _CITY_BY_HANDLE.get(sender_handle, ("Mumbai", 19.076, 72.8777))
    city_name, base_lat, base_lon = city_info

    # Device enrichment
    device_id = flat.device_id or f"DEV-{uuid.uuid4().hex[:8]}"
    device_os = flat.device_os or random.choice(_DEFAULT_OS_OPTIONS)
    device_type = flat.device_type or random.choice(_DEFAULT_DEVICE_TYPES)
    app_version = flat.app_version or random.choice(_DEFAULT_APP_VERSIONS)

    # Network enrichment
    ip_address = flat.sender_ip or _random_indian_ip()

    # Credential
    cred_type = flat.credential_type or "PIN"
    cred_sub_map = {"PIN": "MPIN", "OTP": "SMS_OTP", "BIOMETRIC": "FINGERPRINT"}

    # Receiver type
    recv_type = flat.receiver_type or "PERSON"

    return {
        "tx_id": flat.transaction_id or str(uuid.uuid4()),
        "timestamp": _parse_timestamp(flat.timestamp),
        "amount": flat.amount,
        "currency": "INR",
        "txn_type": "PAY",
        "sender": {
            "sender_id": sender_user_id,
            "upi_id": flat.sender_upi_id,
            "device": {
                "device_id": device_id,
                "device_os": device_os,
                "device_type": device_type,
                "app_version": app_version,
                "capability_mask": "011001",
            },
            "network": {
                "ip_address": ip_address,
            },
            "geo": {
                "lat": flat.lat or (base_lat + random.uniform(-0.05, 0.05)),
                "lon": flat.lon or (base_lon + random.uniform(-0.05, 0.05)),
            },
        },
        "credential": {
            "type": cred_type,
            "sub_type": cred_sub_map.get(cred_type, "MPIN"),
        },
        "receiver": {
            "receiver_id": receiver_user_id,
            "upi_id": flat.receiver_upi_id,
            "receiver_type": recv_type,
            "mcc_code": flat.mcc_code,
        },
        # Extra flat fields carried as metadata (not part of TransactionInput
        # but useful for frontend display)
        "_meta": {
            "sender_name": flat.sender_name,
            "receiver_name": flat.receiver_name,
            "original_status": flat.status,
        },
    }


# ═══ Endpoints ════════════════════════════════════════════════

@upi_adapter_router.post("/upi/ingest", response_model=UPIIngestResponse)
async def ingest_single(tx: UPITransaction):
    """
    Accept a single flat UPI transaction, transform to nested v2,
    and publish onto the Redis stream for fraud scoring.
    """
    if not _redis:
        raise HTTPException(503, "Redis not ready")

    try:
        nested = _upi_to_nested(tx)
        stream_id = await publish_transaction(_redis, nested)
        logger.info(
            "📥 UPI ingest: %s | %s → %s | ₹%.2f | stream_id=%s",
            nested["tx_id"],
            tx.sender_upi_id,
            tx.receiver_upi_id,
            tx.amount,
            stream_id,
        )
        return UPIIngestResponse(accepted=1, stream_ids=[stream_id])
    except Exception as exc:
        logger.error("❌ UPI ingest failed: %s", exc, exc_info=True)
        raise HTTPException(500, f"Ingest error: {exc}")


@upi_adapter_router.post("/upi/ingest/batch", response_model=UPIIngestResponse)
async def ingest_batch(batch: UPIBatchRequest):
    """
    Accept a batch of flat UPI transactions, transform each,
    and publish onto the Redis stream.
    """
    if not _redis:
        raise HTTPException(503, "Redis not ready")

    accepted = 0
    failed = 0
    errors: List[str] = []
    stream_ids: List[str] = []

    for i, tx in enumerate(batch.transactions):
        try:
            nested = _upi_to_nested(tx)
            sid = await publish_transaction(_redis, nested)
            stream_ids.append(sid)
            accepted += 1
        except Exception as exc:
            failed += 1
            errors.append(f"tx[{i}] ({tx.transaction_id or '?'}): {exc}")
            logger.error("❌ Batch item %d failed: %s", i, exc)

    logger.info(
        "📥 UPI batch ingest: %d accepted, %d failed out of %d",
        accepted, failed, len(batch.transactions),
    )
    return UPIIngestResponse(
        accepted=accepted, failed=failed, errors=errors, stream_ids=stream_ids
    )


@upi_adapter_router.post("/upi/ingest/csv", response_model=UPIIngestResponse)
async def ingest_csv_rows(rows: List[Dict[str, Any]]):
    """
    Accept rows matching the CSV header format:
    {
      "Transaction ID": "...",
      "Sender Name": "...",
      "Sender UPI ID": "...",
      "Receiver Name": "...",
      "Receiver UPI ID": "...",
      "Amount (INR)": 1234.56,
      "Status": "SUCCESS",
      "Timestamp": "2024-06-22 04:06:38"
    }
    """
    if not _redis:
        raise HTTPException(503, "Redis not ready")

    accepted = 0
    failed = 0
    errors: List[str] = []
    stream_ids: List[str] = []

    for i, row in enumerate(rows):
        try:
            # Map CSV header names to our flat model
            flat = UPITransaction(
                transaction_id=row.get("Transaction ID") or row.get("transaction_id"),
                timestamp=row.get("Timestamp") or row.get("timestamp"),
                sender_name=row.get("Sender Name") or row.get("sender_name") or "",
                sender_upi_id=row.get("Sender UPI ID") or row.get("sender_upi_id") or "",
                receiver_name=row.get("Receiver Name") or row.get("receiver_name") or "",
                receiver_upi_id=row.get("Receiver UPI ID") or row.get("receiver_upi_id") or "",
                amount=float(row.get("Amount (INR)") or row.get("amount") or 0),
                status=row.get("Status") or row.get("status") or "SUCCESS",
            )
            nested = _upi_to_nested(flat)
            sid = await publish_transaction(_redis, nested)
            stream_ids.append(sid)
            accepted += 1
        except Exception as exc:
            failed += 1
            errors.append(f"row[{i}]: {exc}")
            logger.error("❌ CSV row %d failed: %s", i, exc)

    logger.info(
        "📥 UPI CSV ingest: %d accepted, %d failed out of %d",
        accepted, failed, len(rows),
    )
    return UPIIngestResponse(
        accepted=accepted, failed=failed, errors=errors, stream_ids=stream_ids
    )
