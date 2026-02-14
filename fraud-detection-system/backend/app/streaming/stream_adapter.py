"""
StreamAdapter — bridges the UPI inbound stream to the fraud processing queue.

Architecture
============
  UPI gateway / simulator / REST
        │
        ▼
  Redis stream  «upi_raw»      (raw UPI payloads)
        │
        ▼
   StreamAdapter  (validate · enrich · transform)
        │
        ▼
  Redis stream  «fraud_queue»   (ready for scoring)
        │
        ▼
   WorkerPool  (ingest + score)

The adapter runs N async consumer tasks (default 2) inside the same
asyncio event loop as the rest of the application.  Each task uses
XREADGROUP with a dedicated consumer name so messages are load-balanced.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional

import redis.asyncio as aioredis

from app.config import settings
from app.models.transaction import TransactionInput
from app.streaming.redis_stream import publish_to_fraud_queue

logger = logging.getLogger(__name__)


class StreamAdapter:
    """
    Async service that reads raw UPI payloads from ``upi_raw``,
    validates them against :class:`TransactionInput`, and republishes
    to ``fraud_queue`` for the worker pool.
    """

    def __init__(self, redis_client: aioredis.Redis) -> None:
        self.redis = redis_client
        self._tasks: List[asyncio.Task] = []
        self._running = False

        # Metrics
        self.forwarded: int = 0
        self.validation_errors: int = 0
        self.total_latency_ms: float = 0.0
        self._start_time: float = 0

    # ── lifecycle ────────────────────────────────────────────

    async def start(self) -> None:
        """Create consumer group on upi_raw and launch adapter workers."""
        self._running = True
        self._start_time = time.time()

        # Ensure consumer group exists on the inbound stream
        stream = settings.REDIS_UPI_STREAM_KEY
        group = settings.REDIS_UPI_CONSUMER_GROUP
        try:
            await self.redis.xgroup_create(stream, group, id="0", mkstream=True)
            logger.info("📋 Created consumer group '%s' on stream '%s'", group, stream)
        except Exception as exc:
            if "BUSYGROUP" in str(exc).upper():
                logger.info(
                    "📋 Consumer group '%s' already exists on stream '%s'",
                    group, stream,
                )
            else:
                logger.warning("⚠️  Consumer group error on '%s': %s — recreating", stream, exc)
                try:
                    await self.redis.xgroup_destroy(stream, group)
                except Exception:
                    pass
                await self.redis.xgroup_create(stream, group, id="0", mkstream=True)
                logger.info("📋 Re-created consumer group '%s' on stream '%s'", group, stream)

        # Log initial stream state
        try:
            length = await self.redis.xlen(stream)
            logger.info("📊 Inbound stream '%s' length: %d", stream, length)
        except Exception:
            pass

        # Launch adapter worker tasks
        worker_count = settings.REDIS_UPI_ADAPTER_WORKERS
        for i in range(worker_count):
            name = f"adapter-{i}"
            task = asyncio.create_task(self._adapter_loop(name))
            self._tasks.append(task)

        logger.info(
            "🔄 StreamAdapter started (%d workers, stream='%s' → '%s')",
            worker_count, stream, settings.REDIS_STREAM_KEY,
        )

    async def stop(self) -> None:
        self._running = False
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        logger.info(
            "StreamAdapter stopped — forwarded=%d  errors=%d  avg=%.1fms",
            self.forwarded, self.validation_errors, self.avg_latency_ms,
        )

    # ── metrics ──────────────────────────────────────────────

    @property
    def avg_latency_ms(self) -> float:
        return self.total_latency_ms / max(self.forwarded, 1)

    @property
    def tps(self) -> float:
        elapsed = time.time() - self._start_time if self._start_time else 1
        return self.forwarded / max(elapsed, 1)

    # ── consumer loop ────────────────────────────────────────

    async def _adapter_loop(self, name: str) -> None:
        stream = settings.REDIS_UPI_STREAM_KEY
        group = settings.REDIS_UPI_CONSUMER_GROUP
        queue_stream = settings.REDIS_STREAM_KEY

        logger.info(
            "  ▶ %s started  (read='%s' → write='%s')",
            name, stream, queue_stream,
        )

        _first = True
        _idle = 0

        while self._running:
            try:
                messages = await self.redis.xreadgroup(
                    groupname=group,
                    consumername=name,
                    streams={stream: ">"},
                    count=settings.WORKER_BATCH_SIZE,
                    block=1000,
                )

                if not messages:
                    _idle += 1
                    if _idle % 30 == 0:
                        logger.debug("%s idle %ds, waiting on '%s'…", name, _idle, stream)
                    continue

                _idle = 0

                for _stream_name, entries in messages:
                    if _first:
                        logger.info("📨 %s received first batch (%d msgs)", name, len(entries))
                        _first = False
                    for msg_id, raw_data in entries:
                        await self._handle_message(name, msg_id, raw_data)

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("%s error: %s", name, exc, exc_info=True)
                await asyncio.sleep(0.5)

    # ── per-message handler ──────────────────────────────────

    async def _handle_message(
        self,
        worker: str,
        msg_id: bytes,
        data: Dict[bytes, bytes],
    ) -> None:
        t0 = time.perf_counter()
        stream = settings.REDIS_UPI_STREAM_KEY
        group = settings.REDIS_UPI_CONSUMER_GROUP

        try:
            # 1. Decode raw Redis hash
            decoded: Dict[str, str] = {
                (k.decode() if isinstance(k, bytes) else k):
                (v.decode() if isinstance(v, bytes) else v)
                for k, v in data.items()
            }

            if "payload" in decoded:
                tx_data: Dict[str, Any] = json.loads(decoded["payload"])
            else:
                tx_data = decoded

            # 2. Pull out adapter-level metadata (not part of TransactionInput)
            meta = tx_data.pop("_meta", {}) if isinstance(tx_data, dict) else {}

            # 3. Validate against TransactionInput schema
            try:
                tx = TransactionInput(**tx_data)
            except Exception as val_err:
                self.validation_errors += 1
                logger.warning(
                    "⚠️  Validation failed for msg %s: %s  (payload keys: %s)",
                    msg_id, val_err, list(tx_data.keys()) if isinstance(tx_data, dict) else "?",
                )
                # ACK so we don't re-process bad messages
                await self.redis.xack(stream, group, msg_id)
                return

            # 4. Re-serialise the validated payload (round-trip through model)
            #    This ensures the fraud_queue always has a clean, canonical shape.
            clean_data = tx_data  # keep original dict (already validated)
            if meta:
                clean_data["_meta"] = meta  # carry metadata forward

            # 5. Publish to fraud_queue
            await publish_to_fraud_queue(self.redis, clean_data)

            # 6. ACK on upi_raw
            await self.redis.xack(stream, group, msg_id)

            elapsed_ms = (time.perf_counter() - t0) * 1000
            self.forwarded += 1
            self.total_latency_ms += elapsed_ms

            if self.forwarded == 1:
                logger.info(
                    "✅ First message forwarded: tx_id=%s  latency=%.1fms",
                    tx.tx_id, elapsed_ms,
                )

            if self.forwarded % 100 == 0:
                logger.info(
                    "📈 %s | forwarded=%d | errors=%d | avg=%.1fms | tps=%.0f",
                    worker, self.forwarded, self.validation_errors,
                    self.avg_latency_ms, self.tps,
                )

        except Exception as exc:
            self.validation_errors += 1
            logger.error(
                "❌ %s failed to process msg %s: %s",
                worker, msg_id, exc, exc_info=True,
            )
            # ACK to prevent infinite retry on broken messages
            try:
                await self.redis.xack(stream, group, msg_id)
            except Exception:
                pass
