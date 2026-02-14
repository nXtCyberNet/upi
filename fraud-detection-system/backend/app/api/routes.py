"""
REST API routes.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.transaction import TransactionInput, TransactionResult, RiskLevel, TransactionStatus
from app.models.risk_score import RiskResponse, DashboardStats, ClusterInfo
from app.utils.cypher_queries import (
    INGEST_TRANSACTION,
    INGEST_TRANSACTION_SAFE,
    INGEST_IP,
    VIZ_FRAUD_NETWORK,
    VIZ_DEVICE_SHARING,
    VIZ_DASHBOARD_STATS,
    MAINT_COUNT_NODES,
    MAINT_COUNT_RELS,
)
from app.features.asn_intelligence import resolve as asn_resolve

logger = logging.getLogger(__name__)

router = APIRouter()

# These will be injected by main.py at startup
_neo4j = None
_risk_engine = None
_worker_pool = None
_collusive_detector = None
_graph_analyzer = None
_redis = None


def init_routes(neo4j, risk_engine, worker_pool, collusive, graph_analyzer, redis_client):
    """Called once at startup to inject shared dependencies."""
    global _neo4j, _risk_engine, _worker_pool, _collusive_detector, _graph_analyzer, _redis
    _neo4j = neo4j
    _risk_engine = risk_engine
    _worker_pool = worker_pool
    _collusive_detector = collusive
    _graph_analyzer = graph_analyzer
    _redis = redis_client


# ── health ───────────────────────────────────────────────────

@router.get("/health")
async def health():
    neo4j_health = await _neo4j.health_check() if _neo4j else {"status": "not_initialized"}
    return {
        "status": "ok",
        "neo4j": neo4j_health,
        "workers": {
            "processed": _worker_pool.processed_count if _worker_pool else 0,
            "avg_latency_ms": round(_worker_pool.avg_latency_ms, 2) if _worker_pool else 0,
            "tps": round(_worker_pool.tps, 1) if _worker_pool else 0,
        },
    }


# ── transaction scoring ─────────────────────────────────────

@router.post("/transaction", response_model=RiskResponse)
async def score_transaction(tx: TransactionInput):
    """
    Ingest a single transaction synchronously: write to Neo4j → score → return.
    For high-TPS use the Redis stream instead.
    """
    if not _neo4j or not _risk_engine:
        raise HTTPException(503, "Engine not ready")

    # Build ingest params from nested v2 schema
    ingest_params = {
        "sender_id": tx.sender_id,
        "receiver_id": tx.receiver_id,
        "sender_upi_id": tx.upi_id_sender,
        "receiver_upi_id": tx.upi_id_receiver,
        "device_id": tx.device_id,
        "device_os": tx.device_os,
        "device_type": tx.device_type.value if tx.device_type else None,
        "app_version": tx.app_version,
        "capability_mask": tx.capability_mask,
        "tx_id": tx.tx_id,
        "amount": tx.amount,
        "timestamp": tx.timestamp.isoformat(),
        "currency": tx.currency,
        "txn_type": tx.txn_type.value,
        "credential_type": tx.credential_type.value if tx.credential_type else None,
        "credential_sub_type": tx.credential_sub_type.value if tx.credential_sub_type else None,
        "receiver_type": tx.receiver_type.value,
        "mcc_code": tx.mcc_code,
    }

    # Ingest (try lock-free first, fall back to safe)
    try:
        await _neo4j.write_async(INGEST_TRANSACTION, ingest_params)
    except Exception:
        # Fall back to safe ingest (auto-creates Users)
        try:
            await _neo4j.write_async(INGEST_TRANSACTION_SAFE, ingest_params)
        except Exception as exc:
            logger.error("Ingestion failed: %s", exc)
            raise HTTPException(500, f"Ingestion error: {exc}")

    if tx.ip_address:
        asn_info = asn_resolve(tx.ip_address)
        await _neo4j.write_async(
            INGEST_IP,
            {
                "ip_address": tx.ip_address,
                "geo_lat": tx.sender_lat,
                "geo_lon": tx.sender_lon,
                "is_vpn": False,
                "city": None,
                "country": asn_info.get("country") or None,
                "asn": asn_info.get("asn") or None,
                "asn_type": asn_info.get("asn_class") or None,
                "asn_org": asn_info.get("org_name") or None,
                "asn_country": asn_info.get("country") or None,
                "user_id": tx.sender_id,
            },
        )

    # Score
    response = await _risk_engine.score_transaction(tx)
    return response


# ── dashboard stats ──────────────────────────────────────────

@router.get("/dashboard/stats", response_model=DashboardStats)
async def dashboard_stats():
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")

    from app.config import settings

    rows = await _neo4j.read_async(
        VIZ_DASHBOARD_STATS, {"high_threshold": settings.HIGH_RISK_THRESHOLD}
    )
    r = rows[0] if rows else {}
    return DashboardStats(
        total_transactions=r.get("total_tx", 0) or 0,
        flagged_transactions=r.get("flagged", 0) or 0,
        active_clusters=r.get("active_clusters", 0) or 0,
        avg_risk_score=round(r.get("avg_risk", 0) or 0, 2),
        total_amount_processed=r.get("total_amount", 0) or 0,
        avg_processing_time_ms=round(_worker_pool.avg_latency_ms, 2) if _worker_pool else 0,
        tps=round(_worker_pool.tps, 1) if _worker_pool else 0,
    )


# ── graph visualisation ─────────────────────────────────────

@router.get("/viz/fraud-network")
async def fraud_network(
    min_risk: float = Query(30, ge=0, le=100),
    cluster_ids: Optional[str] = Query(None, description="Comma-separated cluster IDs"),
):
    """Return nodes + edges for the Cytoscape.js fraud network graph."""
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")

    cids = []
    if cluster_ids:
        for c in cluster_ids.split(","):
            try:
                cids.append(int(c.strip()))
            except ValueError:
                cids.append(c.strip())

    rows = await _neo4j.read_async(
        VIZ_FRAUD_NETWORK, {"min_risk": min_risk, "cluster_ids": cids}
    )

    nodes = {}
    edges = []
    for r in rows:
        sid = r.get("source_id")
        tid = r.get("target_id")
        if sid and sid not in nodes:
            nodes[sid] = {
                "id": sid,
                "risk": r.get("source_risk", 0),
                "cluster": r.get("source_cluster"),
            }
        if tid and tid not in nodes:
            nodes[tid] = {
                "id": tid,
                "risk": r.get("target_risk", 0),
                "cluster": r.get("target_cluster"),
            }
        if sid and tid:
            edges.append({
                "source": sid,
                "target": tid,
                "amount": r.get("edge_amount"),
                "tx_count": r.get("edge_tx_count"),
            })

    return {"nodes": list(nodes.values()), "edges": edges}


@router.get("/viz/device-sharing")
async def device_sharing():
    """Return device-sharing clusters for visualisation."""
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")
    rows = await _neo4j.read_async(VIZ_DEVICE_SHARING)
    return {"clusters": rows}


# ── collusive detection results ──────────────────────────────

@router.get("/detection/collusive")
async def collusive_summary():
    if not _collusive_detector:
        raise HTTPException(503, "Detector not ready")
    return _collusive_detector.summary()


# ── graph analytics status ───────────────────────────────────

@router.get("/analytics/status")
async def analytics_status():
    if not _graph_analyzer:
        raise HTTPException(503, "Analyzer not ready")
    return _graph_analyzer.last_run_stats


# ── DB info ──────────────────────────────────────────────────

@router.get("/db/counts")
async def db_counts():
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")
    nodes = await _neo4j.read_async(MAINT_COUNT_NODES)
    rels = await _neo4j.read_async(MAINT_COUNT_RELS)
    return {"nodes": nodes, "relationships": rels}
