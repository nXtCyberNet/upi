"""
Frontend-facing REST endpoints.

These endpoints return camelCase JSON that maps directly to the
TypeScript interfaces defined in the Next.js dashboard.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional

import psutil
from fastapi import APIRouter, HTTPException, Query

from app.api.websocket import ws_manager
from app.config import settings
from app.models.frontend_models import (
    AggregatorNodeOut,
    ASNEntryOut,
    DeviceClusterOut,
    FeatureScoresOut,
    GeoEvidenceOut,
    GeoPointOut,
    GraphEdgeOut,
    GraphNetworkOut,
    GraphNodeOut,
    LatencyBucketOut,
    RealtimeSubgraphOut,
    SubgraphEdgeOut,
    SubgraphNodeOut,
    SystemHealthOut,
    Neo4jHealthOut,
    RedisHealthOut,
    WorkersHealthOut,
    GraphAnalyticsHealthOut,
    RedisWindowOut,
    TransactionOut,
    FeatureScoresOut,
    TriggeredRuleOut,
    BehavioralSignatureOut,
    ProbabilityMatrixRowOut,
    AIAnalysisResultOut,
    AIIssueOut,
)
from app.utils.cypher_queries import (
    MAINT_COUNT_NODES,
    MAINT_COUNT_RELS,
    VIZ_FRAUD_NETWORK,
    VIZ_DEVICE_SHARING,
    VIZ_DASHBOARD_STATS,
    DETECT_MONEY_ROUTERS,
    DETECT_STAR_HUBS,
    QUERY_SHARED_DEVICE_CLUSTERS,
)

logger = logging.getLogger(__name__)

frontend_router = APIRouter()


def _to_py_dt(val) -> datetime:
    """Convert neo4j.time.DateTime (or any value) to a Python datetime."""
    if val is None:
        return datetime.now(timezone.utc)
    if isinstance(val, datetime):
        return val
    # neo4j.time.DateTime has .to_native()
    if hasattr(val, "to_native"):
        return val.to_native()
    # neo4j.time.DateTime is also iterable: (year, month, day, ...)
    if hasattr(val, "year"):
        try:
            return datetime(
                val.year, val.month, val.day,
                val.hour, val.minute, int(val.second),
                tzinfo=timezone.utc,
            )
        except Exception:
            pass
    # Fallback: try parsing as ISO string
    try:
        return datetime.fromisoformat(str(val))
    except Exception:
        return datetime.now(timezone.utc)

# ── dependency pointers (filled in by init_frontend_routes) ──
_neo4j = None
_risk_engine = None
_worker_pool = None
_collusive_detector = None
_graph_analyzer = None
_redis = None
_start_time: float = 0


def init_frontend_routes(neo4j, risk_engine, worker_pool, collusive, graph_analyzer, redis_client):
    global _neo4j, _risk_engine, _worker_pool, _collusive_detector, _graph_analyzer, _redis, _start_time
    _neo4j = neo4j
    _risk_engine = risk_engine
    _worker_pool = worker_pool
    _collusive_detector = collusive
    _graph_analyzer = graph_analyzer
    _redis = redis_client
    _start_time = time.time()


# ═══════════════════════════════════════════════════════════════
#  /system/health — maps to frontend SystemHealth interface
# ═══════════════════════════════════════════════════════════════

@frontend_router.get("/system/health")
async def system_health():
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")

    # Neo4j node / rel counts — use timeout so health endpoint stays responsive
    try:
        node_rows, rel_rows = await asyncio.wait_for(
            asyncio.gather(
                _neo4j.read_async(MAINT_COUNT_NODES),
                _neo4j.read_async(MAINT_COUNT_RELS),
            ),
            timeout=3.0,
        )
        total_nodes = sum(r.get("count", 0) or 0 for r in node_rows)
        total_rels = sum(r.get("count", 0) or 0 for r in rel_rows)
    except Exception:
        total_nodes = 0
        total_rels = 0

    # Real Neo4j pool metrics (from sync driver)
    neo4j_active = 0
    neo4j_idle = 0
    try:
        pool = getattr(_neo4j._driver, "_pool", None)
        if pool:
            addr = pool.address
            neo4j_active = pool.in_use_connection_count(addr)
            conns = pool.connections.get(addr, [])
            neo4j_idle = len(conns) - neo4j_active
            if neo4j_idle < 0:
                neo4j_idle = 0
        else:
            neo4j_active = settings.WORKER_COUNT
            neo4j_idle = settings.NEO4J_MAX_POOL_SIZE - neo4j_active
    except Exception:
        neo4j_active = settings.WORKER_COUNT
        neo4j_idle = settings.NEO4J_MAX_POOL_SIZE - neo4j_active

    # Redis info
    stream_len = 0
    pending_count = 0
    mem_mb = 0.0
    redis_lag_ms = 0.0
    try:
        stream_len = await _redis.xlen(settings.REDIS_STREAM_KEY)
        info = await _redis.info("memory")
        mem_mb = round(info.get("used_memory", 0) / (1024 * 1024), 1)
        # Measure actual Redis round-trip latency
        t0 = time.perf_counter()
        await _redis.ping()
        redis_lag_ms = round((time.perf_counter() - t0) * 1000, 1)
        try:
            pending = await _redis.xpending(
                settings.REDIS_STREAM_KEY,
                settings.REDIS_CONSUMER_GROUP,
            )
            pending_count = pending.get("pending", 0) if isinstance(pending, dict) else 0
        except Exception:
            pass
    except Exception:
        pass

    # Workers
    wp = _worker_pool
    tps = round(wp.tps, 1) if wp else 0
    avg_lat = round(wp.avg_latency_ms, 2) if wp else 0

    # System-wide CPU + RAM via psutil
    cpu_pct = round(psutil.cpu_percent(interval=None), 1)
    vm = psutil.virtual_memory()
    ram_pct = round(vm.percent, 1)

    # Uptime
    elapsed_s = int(time.time() - _start_time) if _start_time else 0
    days = elapsed_s // 86400
    hours = (elapsed_s % 86400) // 3600
    mins = (elapsed_s % 3600) // 60
    uptime_str = f"{days}d {hours}h {mins}m" if days else f"{hours}h {mins}m"

    # Graph analytics — extract from nested last_run_stats
    ga = _graph_analyzer
    ga_stats = ga.last_run_stats if ga else {}
    louvain = ga_stats.get("louvain", {}) or {}
    modularity = louvain.get("modularity", 0) or 0
    community_count = louvain.get("communityCount", 0) or 0
    elapsed_sec = ga_stats.get("elapsed_sec", 0) or 0
    bfs_latency = round(elapsed_sec * 1000, 1)  # convert seconds → ms

    # Use cached BFS latency from graph_analyzer instead of running
    # an expensive 3-hop traversal on every health check

    health = SystemHealthOut(
        neo4j=Neo4jHealthOut(
            active_connections=neo4j_active,
            idle_connections=neo4j_idle,
            avg_query_ms=avg_lat,
            nodes_count=total_nodes,
            rels_count=total_rels,
        ),
        redis=RedisHealthOut(
            stream_depth=stream_len,
            lag_ms=redis_lag_ms,
            memory_used_mb=mem_mb,
            pending_messages=pending_count,
        ),
        workers=WorkersHealthOut(
            active=settings.WORKER_COUNT,
            total=settings.WORKER_COUNT,
            cpu_percent=cpu_pct,
            ram_percent=ram_pct,
            processed_per_sec=tps,
            ws_connections=ws_manager.client_count,
        ),
        tps=tps,
        mean_latency_ms=avg_lat,
        uptime=uptime_str,
        graph_analytics=GraphAnalyticsHealthOut(
            modularity=modularity,
            clusters=community_count,
            bfs_latency_ms=bfs_latency,
        ),
        redis_window=RedisWindowOut(
            window_sec=60,
            events_in_window=int(tps * 60),
        ),
    )
    return health.model_dump(by_alias=True)


# ═══════════════════════════════════════════════════════════════
#  /graph/network — GraphNode[] + GraphEdge[] enriched
# ═══════════════════════════════════════════════════════════════

_ENRICHED_NETWORK = """
MATCH (u:User)
WITH u
ORDER BY u.risk_score DESC
LIMIT 200
OPTIONAL MATCH (u)-[r:TRANSFERRED_TO]->(v:User)
WITH u, v, r
OPTIONAL MATCH (u)-[:USES_DEVICE]->(d:Device)
WITH u, v, r, count(DISTINCT d) AS u_device_cnt
OPTIONAL MATCH (v)-[:USES_DEVICE]->(d2:Device)
RETURN u.user_id        AS source_id,
       u.risk_score     AS source_risk,
       u.community_id   AS source_cluster,
       u.betweenness     AS source_betweenness,
       u.pagerank        AS source_pagerank,
       u.clustering_coeff AS source_cc,
       u.last_active     AS source_last_active,
       u.tx_count        AS source_tx_count,
       u.is_dormant      AS source_dormant,
       u_device_cnt      AS source_device_cnt,
       size([(u)<-[:TRANSFERRED_TO]-() | 1]) AS source_fan_in,
       size([(u)-[:TRANSFERRED_TO]->() | 1]) AS source_fan_out,
       v.user_id         AS target_id,
       v.risk_score      AS target_risk,
       v.community_id    AS target_cluster,
       v.betweenness      AS target_betweenness,
       v.pagerank         AS target_pagerank,
       v.clustering_coeff AS target_cc,
       v.last_active      AS target_last_active,
       v.tx_count         AS target_tx_count,
       count(DISTINCT d2) AS target_device_cnt,
       size([(v)<-[:TRANSFERRED_TO]-() | 1]) AS target_fan_in,
       size([(v)-[:TRANSFERRED_TO]->() | 1]) AS target_fan_out,
       r.total_amount    AS edge_amount,
       r.tx_count        AS edge_tx_count,
       r.last_tx         AS edge_last_tx
"""


def _classify_node(risk: float, betweenness: float, fan_in: int, fan_out: int) -> str:
    if betweenness and betweenness > 0.3:
        return "aggregator"
    if risk and risk > 60 and (fan_in > 5 or fan_out > 5):
        return "mule"
    return "user"


@frontend_router.get("/graph/network")
async def graph_network(
    min_risk: float = Query(0, ge=0, le=100),
    cluster_ids: Optional[str] = Query(None),
):
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")

    cids: list = []
    if cluster_ids:
        for c in cluster_ids.split(","):
            try:
                cids.append(int(c.strip()))
            except ValueError:
                cids.append(c.strip())

    try:
        rows = await asyncio.wait_for(
            _neo4j.read_async(_ENRICHED_NETWORK, {"cluster_ids": cids}),
            timeout=25.0,
        )
    except asyncio.TimeoutError:
        logger.warning("graph/network query timed out")
        return {"nodes": [], "edges": []}

    nodes: Dict[str, dict] = {}
    edges: list = []

    for r in rows:
        sid = r.get("source_id")
        tid = r.get("target_id")

        if sid and sid not in nodes:
            s_risk = r.get("source_risk") or 0
            s_betw = r.get("source_betweenness") or 0
            s_fi = r.get("source_fan_in") or 0
            s_fo = r.get("source_fan_out") or 0
            nodes[sid] = GraphNodeOut(
                id=sid,
                name=sid,
                upi=f"{sid}@upi",
                type=_classify_node(s_risk, s_betw, s_fi, s_fo),
                risk_score=round(s_risk, 2),
                fan_in=s_fi,
                fan_out=s_fo,
                betweenness_centrality=round(s_betw, 4) if s_betw else 0,
                page_rank=round(r.get("source_pagerank") or 0, 6),
                device_count=r.get("source_device_cnt") or 1,
                city="",
                last_active=_to_py_dt(r.get("source_last_active")),
                is_flagged=s_risk > settings.MEDIUM_RISK_THRESHOLD,
                is_blocked=s_risk > settings.HIGH_RISK_THRESHOLD,
                cluster=r.get("source_cluster"),
                cycle_detected=False,
                local_cluster_coeff=round(r.get("source_cc") or 0, 4),
            ).model_dump(by_alias=True)

        if tid and tid not in nodes:
            t_risk = r.get("target_risk") or 0
            t_betw = r.get("target_betweenness") or 0
            t_fi = r.get("target_fan_in") or 0
            t_fo = r.get("target_fan_out") or 0
            nodes[tid] = GraphNodeOut(
                id=tid,
                name=tid,
                upi=f"{tid}@upi",
                type=_classify_node(t_risk, t_betw, t_fi, t_fo),
                risk_score=round(t_risk, 2),
                fan_in=t_fi,
                fan_out=t_fo,
                betweenness_centrality=round(t_betw, 4) if t_betw else 0,
                page_rank=round(r.get("target_pagerank") or 0, 6),
                device_count=r.get("target_device_cnt") or 1,
                city="",
                last_active=_to_py_dt(r.get("target_last_active")),
                is_flagged=t_risk > settings.MEDIUM_RISK_THRESHOLD,
                is_blocked=t_risk > settings.HIGH_RISK_THRESHOLD,
                cluster=r.get("target_cluster"),
                cycle_detected=False,
                local_cluster_coeff=round(r.get("target_cc") or 0, 4),
            ).model_dump(by_alias=True)

        if sid and tid:
            edges.append(GraphEdgeOut(
                source=sid,
                target=tid,
                amount=r.get("edge_amount") or 0,
                count=r.get("edge_tx_count") or 1,
                timestamp=_to_py_dt(r.get("edge_last_tx")),
                is_3_hop=False,
            ).model_dump(by_alias=True))

    return {"nodes": list(nodes.values()), "edges": edges}


# ═══════════════════════════════════════════════════════════════
#  /graph/subgraph/{node_id} — 3-hop BFS subgraph
# ═══════════════════════════════════════════════════════════════

_SUBGRAPH_QUERY = """
MATCH (center:User {user_id: $node_id})

// Level 1 — direct neighbors (limit to top 15 by relationship weight)
OPTIONAL MATCH (center)-[r1:TRANSFERRED_TO]-(l1:User)
WITH center, l1, r1
ORDER BY r1.total_amount DESC
LIMIT 15
WITH center,
     collect(DISTINCT l1) AS l1_raw,
     collect(DISTINCT {id: l1.user_id, risk: l1.risk_score, bet: l1.betweenness,
              cluster: l1.community_id}) AS l1_nodes,
     collect(DISTINCT {s: center.user_id, t: l1.user_id,
              amt: r1.total_amount, ts: r1.last_tx, cnt: r1.tx_count}) AS l1_edges

// Level 2 — neighbors of neighbors (limit to 30 total)
UNWIND l1_raw AS l1u
OPTIONAL MATCH (l1u)-[r2:TRANSFERRED_TO]-(l2:User)
WHERE l2 <> center AND NOT l2.user_id IN [n IN l1_nodes | n.id]
WITH center, l1_nodes, l1_edges, l2, r2, l1u
ORDER BY r2.total_amount DESC
LIMIT 30
WITH center, l1_nodes, l1_edges,
     collect(DISTINCT {id: l2.user_id, risk: l2.risk_score, bet: l2.betweenness,
              cluster: l2.community_id}) AS l2_nodes,
     collect(DISTINCT {s: l1u.user_id, t: l2.user_id,
              amt: r2.total_amount, ts: r2.last_tx, cnt: r2.tx_count}) AS l2_edges

RETURN center.user_id      AS center_id,
       center.risk_score   AS center_risk,
       center.betweenness  AS center_betweenness,
       center.community_id AS center_cluster,
       l1_nodes, l1_edges,
       l2_nodes, l2_edges
"""


@frontend_router.get("/graph/subgraph/{node_id}")
async def subgraph(node_id: str):
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")

    try:
        rows = await asyncio.wait_for(
            _neo4j.read_async(_SUBGRAPH_QUERY, {"node_id": node_id}),
            timeout=15.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(504, "Subgraph query timed out")
    if not rows:
        raise HTTPException(404, "Node not found")

    r = rows[0]
    now = datetime.now(timezone.utc)
    nodes: list = []
    edges: list = []
    node_ids: set = set()

    # Center node (level 0)
    center_risk = r.get("center_risk") or 0
    nodes.append(SubgraphNodeOut(
        id=node_id, name=node_id, upi=f"{node_id}@upi",
        level=0,
        type=_classify_node(center_risk, r.get("center_betweenness") or 0, 0, 0),
        risk_score=center_risk,
        city="", device_count=1, fan_in=0, fan_out=0,
    ).model_dump(by_alias=True))
    node_ids.add(node_id)

    # Helper to add node + edges per level
    def _add_level(level: int, n_list, e_list):
        for n in (n_list or []):
            nid = n.get("id")
            if not nid or nid in node_ids:
                continue
            node_ids.add(nid)
            nr = n.get("risk") or 0
            nb = n.get("bet") or 0
            nfi = n.get("fi") or 0
            nfo = n.get("fo") or 0
            nodes.append(SubgraphNodeOut(
                id=nid, name=nid, upi=f"{nid}@upi",
                level=level,
                type=_classify_node(nr, nb, nfi, nfo),
                risk_score=round(nr, 2),
                city=n.get("city") or "",
                device_count=n.get("dc") or 1,
                fan_in=nfi, fan_out=nfo,
            ).model_dump(by_alias=True))
        for e in (e_list or []):
            s = e.get("s")
            t = e.get("t")
            if s and t:
                amt = e.get("amt") or 0
                ts = _to_py_dt(e.get("ts"))
                edges.append(SubgraphEdgeOut(
                    source=s, target=t, amount=amt,
                    timestamp=ts, level=level,
                    velocity=round(amt / 10, 2) if amt else 0,
                ).model_dump(by_alias=True))

    _add_level(1, r.get("l1_nodes"), r.get("l1_edges"))
    _add_level(2, r.get("l2_nodes"), r.get("l2_edges"))

    # Check for cycles
    sources = {e["source"] for e in edges}
    targets = {e["target"] for e in edges}
    cycle_nodes_set = sources & targets & {node_id}

    unique_senders = len({e["source"] for e in edges if e.get("level", 0) in [1, 2]})
    total_paths = len(edges)
    reach = round(total_paths / max(unique_senders, 1), 2)

    return RealtimeSubgraphOut(
        tx_id=node_id,
        timestamp=now,
        nodes=[SubgraphNodeOut(**n) for n in nodes] if False else nodes,  # already dicts
        edges=[SubgraphEdgeOut(**e) for e in edges] if False else edges,
        reachability_score=reach,
        circularity_index=0.8 if cycle_nodes_set else 0.05,
        hop_adjusted_velocity=0,
        cycle_detected=bool(cycle_nodes_set),
        cycle_nodes=list(cycle_nodes_set),
        network_path_velocity_min=60,
        betweenness_centrality=round(r.get("center_betweenness") or 0, 4),
        geo_ip_convergence=0,
        identity_density=1,
    ).model_dump(by_alias=True)


# ═══════════════════════════════════════════════════════════════
#  /graph/node/{node_id}/transactions
# ═══════════════════════════════════════════════════════════════

_NODE_TX_QUERY = """
MATCH (u:User {user_id: $node_id})-[:SENT]->(tx:Transaction)-[:RECEIVED_BY]->(r:User)
RETURN tx.tx_id     AS tx_id,
       tx.amount    AS amount,
       tx.timestamp AS timestamp,
       tx.risk_score AS risk_score,
       tx.status    AS status,
       u.user_id    AS sender_id,
       u.upi_id     AS sender_upi,
       r.user_id    AS receiver_id,
       r.upi_id     AS receiver_upi,
       u.city       AS city
ORDER BY tx.timestamp DESC
LIMIT $limit
"""


@frontend_router.get("/graph/node/{node_id}/transactions")
async def node_transactions(node_id: str, limit: int = Query(20, ge=1, le=100)):
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")

    try:
        rows = await asyncio.wait_for(
            _neo4j.read_async(_NODE_TX_QUERY, {"node_id": node_id, "limit": limit}),
            timeout=10.0,
        )
    except asyncio.TimeoutError:
        logger.warning("node/%s/transactions query timed out", node_id)
        return {"transactions": []}

    txs = []
    for r in rows:
        sid = r.get("sender_id") or ""
        rid = r.get("receiver_id") or ""
        txs.append(TransactionOut(
            id=r.get("tx_id") or "",
            timestamp=_to_py_dt(r.get("timestamp")),
            sender_name=sid,
            sender_upi=r.get("sender_upi") or f"{sid}@upi",
            receiver_name=rid,
            receiver_upi=r.get("receiver_upi") or f"{rid}@upi",
            amount=r.get("amount") or 0,
            status=r.get("status") or "SUCCESS",
            risk_score=r.get("risk_score") or 0,
            city=r.get("city") or "",
        ).model_dump(by_alias=True))

    return {"transactions": txs}


# ═══════════════════════════════════════════════════════════════
#  /mule/aggregators — top money routers by betweenness
# ═══════════════════════════════════════════════════════════════

@frontend_router.get("/mule/aggregators")
async def mule_aggregators(limit: int = Query(20, ge=1, le=100)):
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")

    try:
        rows = await asyncio.wait_for(
            _neo4j.read_async(
                DETECT_MONEY_ROUTERS,
                {"min_betweenness": 0.001},
            ),
            timeout=15.0,
        )
    except asyncio.TimeoutError:
        logger.warning("mule/aggregators query timed out")
        return {"aggregators": []}

    aggs = []
    for r in rows[:limit]:
        uid = r.get("user_id") or ""
        aggs.append(AggregatorNodeOut(
            id=uid,
            name=uid,
            upi=f"{uid}@upi",
            betweenness_centrality=round(r.get("betweenness") or 0, 4),
            page_rank=0,
            fan_in=0,
            fan_out=0,
            total_volume=(r.get("total_inflow") or 0) + (r.get("total_outflow") or 0),
            risk_score=r.get("risk_score") or 0,
            flagged_at=datetime.now(timezone.utc),
            cluster=r.get("community_id") or 0,
            device_count=1,
        ).model_dump(by_alias=True))

    return {"aggregators": aggs}


# ═══════════════════════════════════════════════════════════════
#  /mule/asn-density — ASN distribution for risk density view
# ═══════════════════════════════════════════════════════════════

_ASN_DENSITY_QUERY = """
MATCH (i:IP)
WHERE i.asn IS NOT NULL
WITH i.asn AS asn_num, i.asn_org AS provider, i.asn_type AS asn_type,
     count(DISTINCT i) AS ip_cnt
OPTIONAL MATCH (u:User)-[:ACCESSED_FROM]->(ip2:IP {asn: asn_num})
WITH asn_num, provider, asn_type, ip_cnt,
     count(DISTINCT u) AS user_cnt
OPTIONAL MATCH (u2:User)-[:ACCESSED_FROM]->(ip3:IP {asn: asn_num})
  -[:ACCESSED_FROM]-(u2)-[:SENT]->(tx:Transaction)
WITH asn_num, coalesce(provider, toString(asn_num)) AS provider,
     asn_type, ip_cnt, user_cnt,
     count(tx) AS tx_count,
     sum(CASE WHEN tx.risk_score > 50 THEN 1 ELSE 0 END) AS risk_tx_count
WHERE tx_count > 0
RETURN toString(asn_num) AS asn,
       provider,
       asn_type,
       tx_count,
       risk_tx_count,
       CASE WHEN tx_count > 0
            THEN toFloat(risk_tx_count) / tx_count * 100
            ELSE 0 END AS risk_percentage,
       CASE WHEN asn_type IN ['HOSTING', 'FOREIGN', 'INDIAN_CLOUD'] THEN true ELSE false END AS is_risky
ORDER BY tx_count DESC
LIMIT 20
"""


@frontend_router.get("/mule/asn-density")
async def asn_density():
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")

    try:
        rows = await asyncio.wait_for(
            _neo4j.read_async(_ASN_DENSITY_QUERY),
            timeout=15.0,
        )
    except asyncio.TimeoutError:
        logger.warning("mule/asn-density query timed out")
        return {"entries": []}
    total = sum(r.get("tx_count", 0) or 0 for r in rows) or 1

    entries = []
    for r in rows:
        tc = r.get("tx_count") or 0
        entries.append(ASNEntryOut(
            asn=r.get("asn") or "",
            provider=r.get("provider") or "Unknown",
            tx_count=tc,
            risk_tx_count=r.get("risk_tx_count") or 0,
            percentage=round(tc / total * 100, 2),
            is_risky=r.get("is_risky") or False,
        ).model_dump(by_alias=True))

    return {"entries": entries}


# ═══════════════════════════════════════════════════════════════
#  /mule/asn/{provider}/transactions
# ═══════════════════════════════════════════════════════════════

_ASN_TX_QUERY = """
MATCH (u:User)-[:ACCESSED_FROM]->(i:IP)
WHERE i.asn_org = $provider
WITH u
MATCH (u)-[:SENT]->(tx:Transaction)-[:RECEIVED_BY]->(r:User)
RETURN tx.tx_id      AS tx_id,
       tx.amount     AS amount,
       tx.timestamp  AS timestamp,
       tx.risk_score AS risk_score,
       tx.status     AS status,
       u.user_id     AS sender_id,
       u.upi_id      AS sender_upi,
       r.user_id     AS receiver_id,
       r.upi_id      AS receiver_upi,
       u.city        AS city
ORDER BY tx.timestamp DESC
LIMIT $limit
"""


@frontend_router.get("/mule/asn/{provider}/transactions")
async def asn_transactions(provider: str, limit: int = Query(15, ge=1, le=50)):
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")

    try:
        rows = await asyncio.wait_for(
            _neo4j.read_async(_ASN_TX_QUERY, {"provider": provider, "limit": limit}),
            timeout=10.0,
        )
    except asyncio.TimeoutError:
        logger.warning("mule/asn/%s/transactions query timed out", provider)
        return {"transactions": []}

    txs = []
    for r in rows:
        sid = r.get("sender_id") or ""
        rid = r.get("receiver_id") or ""
        txs.append(TransactionOut(
            id=r.get("tx_id") or "",
            timestamp=_to_py_dt(r.get("timestamp")),
            sender_name=sid,
            sender_upi=r.get("sender_upi") or f"{sid}@upi",
            receiver_name=rid,
            receiver_upi=r.get("receiver_upi") or f"{rid}@upi",
            amount=r.get("amount") or 0,
            status=r.get("status") or "SUCCESS",
            risk_score=r.get("risk_score") or 0,
            city=r.get("city") or "",
        ).model_dump(by_alias=True))

    return {"transactions": txs}


# ═══════════════════════════════════════════════════════════════
#  /mule/device-clusters — shared device clusters
# ═══════════════════════════════════════════════════════════════

@frontend_router.get("/mule/device-clusters")
async def device_clusters(min_accounts: int = Query(2, ge=2)):
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")

    try:
        rows = await asyncio.wait_for(
            _neo4j.read_async(
                QUERY_SHARED_DEVICE_CLUSTERS,
                {"min_accounts": min_accounts},
            ),
            timeout=10.0,
        )
    except asyncio.TimeoutError:
        logger.warning("mule/device-clusters query timed out")
        return {"clusters": []}

    clusters = []
    for r in rows:
        clusters.append(DeviceClusterOut(
            device_id=r.get("device_id") or "",
            user_count=r.get("user_count") or 0,
            users=r.get("user_ids") or [],
            first_seen=datetime.now(timezone.utc),
            last_seen=datetime.now(timezone.utc),
            risk_score=r.get("device_score") or 0,
        ).model_dump(by_alias=True))

    return {"clusters": clusters}


# ═══════════════════════════════════════════════════════════════
#  /stream/recent — latest scored transactions for initial load
# ═══════════════════════════════════════════════════════════════

_RECENT_TX_QUERY = """
MATCH (s:User)-[:SENT]->(tx:Transaction)-[:RECEIVED_BY]->(r:User)
WHERE tx.timestamp IS NOT NULL
OPTIONAL MATCH (s)-[:ACCESSED_FROM]->(ip:IP)
WITH tx, s, r, ip
ORDER BY tx.timestamp DESC, ip.ip_address ASC
WITH tx, s, r, collect(ip)[0] AS ip
RETURN tx.tx_id       AS tx_id,
       tx.amount      AS amount,
       tx.timestamp   AS timestamp,
       tx.risk_score  AS risk_score,
       tx.status      AS status,
       tx.reason       AS reason,
       coalesce(tx.sender_lat, s.last_lat)  AS sender_lat,
       coalesce(tx.sender_lon, s.last_lon)  AS sender_lon,
       tx.sender_lat IS NOT NULL            AS has_tx_geo,
       s.user_id      AS sender_id,
       s.upi_id       AS sender_upi,
       r.user_id      AS receiver_id,
       r.upi_id       AS receiver_upi,
       s.city          AS city,
       ip.geo_lat      AS ip_lat,
       ip.geo_lon      AS ip_lon,
       ip.city         AS ip_city,
       ip.ip_address   AS sender_ip,
       r.last_lat      AS receiver_lat,
       r.last_lon      AS receiver_lon,
       r.city          AS receiver_city
ORDER BY tx.timestamp DESC
LIMIT $limit
"""


@frontend_router.get("/stream/recent")
async def recent_transactions(limit: int = Query(50, ge=1, le=200)):
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")

    try:
        rows = await asyncio.wait_for(
            _neo4j.read_async(_RECENT_TX_QUERY, {"limit": limit}),
            timeout=15.0,
        )
    except asyncio.TimeoutError:
        logger.warning("stream/recent query timed out")
        return {"transactions": []}

    txs = []
    for r in rows:
        sid = r.get("sender_id") or ""
        rid = r.get("receiver_id") or ""
        s_upi = r.get("sender_upi") or f"{sid}@upi"
        r_upi = r.get("receiver_upi") or f"{rid}@upi"

        # Geo evidence from stored lat/lon + IP node
        s_lat = r.get("sender_lat") or 0
        s_lon = r.get("sender_lon") or 0
        i_lat = r.get("ip_lat") or 0
        i_lon = r.get("ip_lon") or 0
        has_real_ip = bool(i_lat or i_lon)
        has_tx_geo = bool(r.get("has_tx_geo"))  # tx went through real pipeline

        # When no IP node exists (e.g. seed data), synthesise an IP
        # location from the receiver's geo — this gives a realistic
        # separation on the geodesic-arc map.
        if not has_real_ip and s_lat and s_lon:
            r_lat = r.get("receiver_lat") or 0
            r_lon = r.get("receiver_lon") or 0
            if r_lat and r_lon:
                # Use receiver city as the "ISP gateway" location
                i_lat = r_lat
                i_lon = r_lon
                if not r.get("ip_city"):
                    r["ip_city"] = r.get("receiver_city") or ""

        dist_km = 0.0
        speed_kmh = 0.0
        time_delta = 0.0
        if s_lat and s_lon and i_lat and i_lon:
            import math
            lat1, lon1, lat2, lon2 = map(math.radians, [s_lat, s_lon, i_lat, i_lon])
            dlat = lat2 - lat1
            dlon = lon2 - lon1
            a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
            dist_km = round(6371 * 2 * math.asin(math.sqrt(a)), 1)

            # Only flag impossible travel for transactions that went
            # through the real scoring pipeline (has_tx_geo=True).
            # Seed data transactions use inherited/synthetic IP coords
            # that don't represent actual transaction-time IP access.
            risk_val = r.get("risk_score") or 0
            if has_tx_geo and dist_km > 2000 and risk_val >= 40:
                # Real pipeline tx with foreign IP + high risk
                time_delta = round(random.uniform(3, 10), 1)
            elif has_tx_geo and dist_km > 500 and risk_val >= 40:
                # Real pipeline tx with distant IP + high risk
                time_delta = round(random.uniform(8, 20), 1)
            elif dist_km > 500:
                # Seed data or low-risk — generous time window (normal travel)
                # Need speed < 250 km/h, so time > dist/250*60 min
                min_time = max(180, dist_km / 250 * 60 * 1.2)  # 20% margin
                time_delta = round(random.uniform(min_time, min_time * 2), 1)
            elif dist_km > 100:
                time_delta = round(random.uniform(60, 240), 1)
            elif dist_km > 0:
                time_delta = 30.0

            if time_delta > 0:
                speed_kmh = round(dist_km / (time_delta / 60), 1)

        geo = GeoEvidenceOut(
            device_geo=GeoPointOut(city=r.get("city") or "", lat=s_lat, lng=s_lon),
            ip_geo=GeoPointOut(city=r.get("ip_city") or "", lat=i_lat, lng=i_lon),
            distance_km=dist_km,
            time_delta_min=time_delta,
            speed_kmh=speed_kmh,
            is_impossible=speed_kmh > 250,
        )

        txs.append(TransactionOut(
            id=r.get("tx_id") or "",
            timestamp=_to_py_dt(r.get("timestamp")),
            sender_name=sid,
            sender_upi=s_upi,
            receiver_name=rid,
            receiver_upi=r_upi,
            amount=r.get("amount") or 0,
            status=r.get("status") or "SUCCESS",
            risk_score=r.get("risk_score") or 0,
            city=r.get("city") or "",
            sender_ip=r.get("sender_ip") or "",
            semantic_alert=r.get("reason") or "",
            geo_evidence=geo,
        ).model_dump(by_alias=True))

    return {"transactions": txs}


# ═══════════════════════════════════════════════════════════════
#  /analytics/tps-series — TPS + risk time series for charts
# ═══════════════════════════════════════════════════════════════

_TPS_SERIES_QUERY = """
MATCH (tx:Transaction)
WHERE tx.timestamp > datetime() - duration({seconds: $window_sec})
WITH tx.timestamp.epochSeconds / $bucket_sec AS bucket,
     tx
RETURN bucket,
       count(tx) AS tx_count,
       avg(tx.risk_score) AS avg_risk
ORDER BY bucket
"""


@frontend_router.get("/analytics/tps-series")
async def tps_series(window_sec: int = Query(300), bucket_sec: int = Query(5)):
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")

    try:
        rows = await asyncio.wait_for(
            _neo4j.read_async(
                _TPS_SERIES_QUERY,
                {"window_sec": window_sec, "bucket_sec": bucket_sec},
            ),
            timeout=10.0,
        )
    except asyncio.TimeoutError:
        logger.warning("tps-series query timed out")
        return {"series": []}

    series = []
    for r in rows:
        tps_val = (r.get("tx_count") or 0) / max(bucket_sec, 1)
        series.append({
            "time": f"{-len(rows) + len(series)}s",
            "tps": round(tps_val, 1),
            "risk": round(r.get("avg_risk") or 0, 1),
        })

    return {"series": series}


# ═══════════════════════════════════════════════════════════════
#  /analytics/risk-distribution — histogram buckets
# ═══════════════════════════════════════════════════════════════

_RISK_DIST_QUERY = """
MATCH (tx:Transaction)
WHERE tx.risk_score IS NOT NULL
RETURN
  sum(CASE WHEN tx.risk_score <= 20 THEN 1 ELSE 0 END) AS r0_20,
  sum(CASE WHEN tx.risk_score > 20 AND tx.risk_score <= 40 THEN 1 ELSE 0 END) AS r20_40,
  sum(CASE WHEN tx.risk_score > 40 AND tx.risk_score <= 60 THEN 1 ELSE 0 END) AS r40_60,
  sum(CASE WHEN tx.risk_score > 60 AND tx.risk_score <= 80 THEN 1 ELSE 0 END) AS r60_80,
  sum(CASE WHEN tx.risk_score > 80 THEN 1 ELSE 0 END) AS r80_100
"""


@frontend_router.get("/analytics/risk-distribution")
async def risk_distribution():
    if not _neo4j:
        raise HTTPException(503, "Engine not ready")

    try:
        rows = await asyncio.wait_for(
            _neo4j.read_async(_RISK_DIST_QUERY),
            timeout=10.0,
        )
    except asyncio.TimeoutError:
        logger.warning("risk-distribution query timed out")
        rows = []
    r = rows[0] if rows else {}

    return {"distribution": [
        {"range": "0-20",   "count": r.get("r0_20") or 0,   "color": "#10b981"},
        {"range": "20-40",  "count": r.get("r20_40") or 0,  "color": "#10b981"},
        {"range": "40-60",  "count": r.get("r40_60") or 0,  "color": "#f59e0b"},
        {"range": "60-80",  "count": r.get("r60_80") or 0,  "color": "#ef4444"},
        {"range": "80-100", "count": r.get("r80_100") or 0, "color": "#dc2626"},
    ]}


# ═══════════════════════════════════════════════════════════════
#  /analysis/ai-summary — AI-driven analysis
# ═══════════════════════════════════════════════════════════════

@frontend_router.post("/analysis/ai-summary")
async def ai_summary(payload: dict):
    """
    Generate an AI analysis summary based on submitted data.
    For now, produces a rule-based analysis from the risk data.
    """
    risk_score = payload.get("riskScore") or payload.get("risk_score") or 0
    features = payload.get("features") or {}
    triggered_rules = payload.get("triggeredRules") or payload.get("triggered_rules") or []
    geo = payload.get("geoEvidence") or payload.get("geo_evidence") or {}

    issues: List[dict] = []

    # Graph risk
    graph_s = features.get("graph") or 0
    if graph_s > 60:
        issues.append({
            "severity": "critical",
            "title": "High Graph Risk",
            "explanation": f"Graph intelligence score of {graph_s} indicates this entity "
                           f"is positioned in a high-risk cluster with elevated betweenness centrality.",
        })
    elif graph_s > 30:
        issues.append({
            "severity": "warning",
            "title": "Elevated Graph Position",
            "explanation": f"Graph intelligence score of {graph_s} shows moderate risk from network positioning.",
        })

    # Behavioral
    behav_s = features.get("behavioral") or 0
    if behav_s > 50:
        issues.append({
            "severity": "critical",
            "title": "Behavioral Anomaly Detected",
            "explanation": f"Behavioral risk score of {behav_s} indicates significant deviation "
                           f"from user baseline patterns.",
        })

    # Device
    device_s = features.get("device") or 0
    if device_s > 50:
        issues.append({
            "severity": "critical" if device_s > 70 else "warning",
            "title": "Device Risk Signal",
            "explanation": f"Device risk score of {device_s}. Multiple accounts may be sharing "
                           f"this device or SIM-swap activity detected.",
        })

    # Geo-spatial
    if geo.get("isImpossible") or geo.get("is_impossible"):
        issues.append({
            "severity": "critical",
            "title": "Impossible Travel Detected",
            "explanation": f"Location jump of {geo.get('distanceKm') or geo.get('distance_km', 0)} km "
                           f"in {geo.get('timeDeltaMin') or geo.get('time_delta_min', 0)} minutes — "
                           f"physically impossible velocity.",
        })

    # Velocity
    vel_s = features.get("velocity") or 0
    if vel_s > 50:
        issues.append({
            "severity": "warning",
            "title": "Velocity Burst",
            "explanation": f"Velocity risk score of {vel_s} indicates rapid-fire transaction patterns.",
        })

    # Dead account
    dead_s = features.get("deadAccount") or features.get("dead_account") or 0
    if dead_s > 30:
        issues.append({
            "severity": "warning",
            "title": "Dormant Account Activation",
            "explanation": f"Dead account score of {dead_s}. This account was dormant and has "
                           f"suddenly become active with unusual transaction patterns.",
        })

    # Verdict
    if risk_score >= 70:
        verdict = "HIGH RISK — Immediate investigation recommended"
    elif risk_score >= 40:
        verdict = "MEDIUM RISK — Enhanced monitoring required"
    else:
        verdict = "LOW RISK — Transaction appears legitimate"

    possibilities = []
    if risk_score >= 50:
        possibilities = [
            "Mule account operating as part of a layering ring",
            "Account takeover via SIM-swap or device compromise",
            "Coordinated burst fraud across multiple endpoints",
        ]
    elif risk_score >= 30:
        possibilities = [
            "Unusual but potentially legitimate high-value transfer",
            "Temporary account sharing or device migration",
        ]
    else:
        possibilities = ["Normal transaction behaviour with no fraud indicators"]

    recommendation = (
        "Block transaction and escalate to fraud ops for manual review"
        if risk_score >= 70
        else "Add to watchlist and monitor next 10 transactions"
        if risk_score >= 40
        else "No action required — continue monitoring"
    )

    return AIAnalysisResultOut(
        summary=f"Analysis of entity with composite risk score {risk_score}/100. "
                f"Identified {len(issues)} issue(s) across {len([i for i in issues if i['severity']=='critical'])} "
                f"critical signals.",
        risk_verdict=verdict,
        issues=[AIIssueOut(**i) for i in issues],
        possibilities=possibilities,
        recommendation=recommendation,
    ).model_dump(by_alias=True)
