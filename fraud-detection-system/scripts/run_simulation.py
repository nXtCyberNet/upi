
#!/usr/bin/env python3
"""
run_simulation.py – Controlled transaction simulator with structured logs.
"""

import sys
import os
import argparse
import asyncio
import time
import logging

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.config import settings
from app.streaming.redis_stream import get_redis_client
from app.streaming.transaction_simulator import TransactionSimulator


# ───────────────── Logging Setup ─────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)

logger = logging.getLogger("simulation")


# ───────────────── Simulation Runner ─────────────────

async def run(total_tx: int, tps: int):
    logger.info(f"Connecting to Redis at {settings.REDIS_HOST}:{settings.REDIS_PORT}")
    redis_client = await get_redis_client()
    logger.info("Redis connected")

    sim = TransactionSimulator(redis_client)

    logger.info(f"Starting simulation: total_tx={total_tx}, tps={tps}")

    start_time = time.time()
    sent = 0

    # Send first request separately (explicit log)
    logger.info("Sending first transaction...")
    first_sent = await sim.run(total_tx=1, tps=tps)
    sent += first_sent
    logger.info("First transaction sent successfully")

    remaining = total_tx - 1

    if remaining > 0:
        logger.info("Continuing simulation...")

        # Chunked execution for logging visibility
        chunk_size = max(10, tps)  # log roughly once per second

        while sent < total_tx:
            to_send = min(chunk_size, total_tx - sent)
            chunk_sent = await sim.run(total_tx=to_send, tps=tps)
            sent += chunk_sent

            elapsed = time.time() - start_time
            current_rate = sent / elapsed if elapsed > 0 else 0

            logger.info(
                f"Progress | sent={sent}/{total_tx} "
                f"| elapsed={elapsed:.2f}s "
                f"| avg_rate={current_rate:.2f} tx/s"
            )

    duration = time.time() - start_time

    logger.info("Simulation finished")
    logger.info(f"Total sent: {sent}")
    logger.info(f"Total duration: {duration:.2f}s")
    logger.info(f"Average TPS: {sent/duration:.2f}")

    stream_len = await redis_client.xlen(settings.REDIS_STREAM_KEY)
    logger.info(f"Redis stream length: {stream_len}")

    await redis_client.close()
    logger.info("Simulation complete")


# ───────────────── CLI Entry ─────────────────

def main():
    parser = argparse.ArgumentParser(description="Run fraud transaction simulation")
    parser.add_argument("--tx", type=int, default=settings.SIMULATION_TOTAL_TX)
    parser.add_argument("--tps", type=int, default=settings.SIMULATION_TPS)
    args = parser.parse_args()

    asyncio.run(run(args.tx, args.tps))


if __name__ == "__main__":
    main()
