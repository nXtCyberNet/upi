"""
Redis Streams producer / consumer helpers.

Two-stream architecture
=======================
  upi_raw     ←  Raw UPI gateway payloads (simulator / REST / external)
  fraud_queue ←  Validated & enriched payloads ready for fraud scoring

  StreamAdapter bridges:  upi_raw  →  fraud_queue
  WorkerPool  consumes:   fraud_queue
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict

import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)


# ── Connection ───────────────────────────────────────────────

async def get_redis_client() -> aioredis.Redis:
    """Create and return an async Redis client."""
    client = aioredis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        db=settings.REDIS_DB,
        decode_responses=False,
    )
    await client.ping()
    logger.info("✅ Redis connected at %s:%d", settings.REDIS_HOST, settings.REDIS_PORT)
    return client


# ── Inbound stream  (upi_raw) ───────────────────────────────

async def publish_upi_raw(
    redis_client: aioredis.Redis,
    tx_data: Dict[str, Any],
) -> str:
    """
    Push a raw UPI transaction onto the *inbound* stream (upi_raw).
    The StreamAdapter will pick it up, validate, and forward to fraud_queue.
    Returns the stream message ID.
    """
    payload = json.dumps(tx_data, default=str)
    msg_id = await redis_client.xadd(
        settings.REDIS_UPI_STREAM_KEY,
        {"payload": payload},
    )
    return msg_id.decode() if isinstance(msg_id, bytes) else str(msg_id)


# Legacy alias – simulator & upi_adapter use this name
publish_transaction = publish_upi_raw


# ── Processing stream  (fraud_queue) ────────────────────────

async def publish_to_fraud_queue(
    redis_client: aioredis.Redis,
    tx_data: Dict[str, Any],
) -> str:
    """
    Push a validated transaction onto the *processing* stream (fraud_queue).
    The WorkerPool consumers drain this stream.
    Returns the stream message ID.
    """
    payload = json.dumps(tx_data, default=str)
    msg_id = await redis_client.xadd(
        settings.REDIS_STREAM_KEY,
        {"payload": payload},
    )
    return msg_id.decode() if isinstance(msg_id, bytes) else str(msg_id)


# ── Alerts (pub/sub) ────────────────────────────────────────

async def publish_alert(
    redis_client: aioredis.Redis,
    alert_data: Dict[str, Any],
) -> int:
    """
    Publish a fraud alert on the pub/sub channel.
    Returns the number of subscribers that received the message.
    """
    payload = json.dumps(alert_data, default=str)
    return await redis_client.publish(settings.REDIS_ALERTS_CHANNEL, payload)


# ── Stream info helpers ─────────────────────────────────────

async def stream_length(redis_client: aioredis.Redis, stream: str | None = None) -> int:
    """Return the current length of a stream (defaults to fraud_queue)."""
    return await redis_client.xlen(stream or settings.REDIS_STREAM_KEY)


async def upi_stream_length(redis_client: aioredis.Redis) -> int:
    """Return the current length of the upi_raw inbound stream."""
    return await redis_client.xlen(settings.REDIS_UPI_STREAM_KEY)
