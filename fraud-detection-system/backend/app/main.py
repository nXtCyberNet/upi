"""
FastAPI application entry-point.

Lifespan:
  startup  → connect Neo4j, Redis; setup schema; start workers + graph analyzer
  shutdown → stop workers, graph analyzer; close connections
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.neo4j_manager import Neo4jManager
from app.streaming.redis_stream import get_redis_client
from app.core.risk_engine import RiskEngine
from app.core.graph_analyzer import GraphAnalyzer
from app.core.worker_pool import WorkerPool
from app.streaming.stream_adapter import StreamAdapter
from app.detection.collusive_fraud import CollusiveFraudDetector
from app.api.routes import router as api_router, init_routes
from app.api.frontend_routes import frontend_router, init_frontend_routes
from app.api.upi_adapter import upi_adapter_router, init_upi_adapter
from app.api.websocket import websocket_endpoint, alert_callback
from app.utils.cypher_queries import SCHEMA_CONSTRAINTS, SCHEMA_INDEXES

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(levelname)-7s │ %(name)s │ %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    logger.info("🚀 Starting %s v%s", settings.APP_NAME, settings.APP_VERSION)

    # ── Neo4j ────────────────────────────────────────────────
    neo4j = Neo4jManager.get_instance()
    await neo4j.connect()
    neo4j.setup_schema(SCHEMA_CONSTRAINTS, SCHEMA_INDEXES)

    # ── Redis ────────────────────────────────────────────────
    redis_client = await get_redis_client()

    # ── Detection modules ────────────────────────────────────
    collusive = CollusiveFraudDetector(neo4j)

    # ── Risk engine ──────────────────────────────────────────
    risk_engine = RiskEngine(neo4j)
    risk_engine.set_collusive_detector(collusive)

    # ── Graph analyzer (batch loop) ──────────────────────────
    graph_analyzer = GraphAnalyzer(neo4j, collusive)
    await graph_analyzer.start()

    # ── Stream adapter (upi_raw → fraud_queue) ───────────────
    stream_adapter = StreamAdapter(redis_client)
    await stream_adapter.start()

    # ── Worker pool ──────────────────────────────────────────
    worker_pool = WorkerPool(
        neo4j=neo4j,
        risk_engine=risk_engine,
        redis_client=redis_client,
        alert_callback=alert_callback,
    )
    await worker_pool.start()

    # ── Inject deps into routes ──────────────────────────────
    init_routes(neo4j, risk_engine, worker_pool, collusive, graph_analyzer, redis_client)
    init_frontend_routes(neo4j, risk_engine, worker_pool, collusive, graph_analyzer, redis_client)
    init_upi_adapter(redis_client)

    # store on app.state for ad-hoc access
    app.state.neo4j = neo4j
    app.state.redis = redis_client
    app.state.risk_engine = risk_engine
    app.state.worker_pool = worker_pool
    app.state.stream_adapter = stream_adapter
    app.state.graph_analyzer = graph_analyzer
    app.state.collusive = collusive

    logger.info("✅ All systems online")
    yield

    # ── shutdown ─────────────────────────────────────────────
    logger.info("Shutting down …")
    await worker_pool.stop()
    await stream_adapter.stop()
    await graph_analyzer.stop()
    from app.features.asn_intelligence import close_reader as close_mmdb
    close_mmdb()
    await neo4j.close()
    await redis_client.close()
    logger.info("👋 Shutdown complete")


# ── App ──────────────────────────────────────────────────────

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# REST routes
app.include_router(api_router, prefix="/api")
app.include_router(frontend_router, prefix="/api")
app.include_router(upi_adapter_router, prefix="/api")

# WebSocket route
app.websocket("/ws/alerts")(websocket_endpoint)


@app.get("/")
async def root():
    return {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
    }
