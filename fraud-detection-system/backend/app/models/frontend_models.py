"""
Frontend-facing Pydantic response models.

All models use camelCase aliases to match the Next.js TypeScript interfaces
defined in the frontend (src/lib/mock-data.ts).
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    """Base model with camelCase JSON aliases for all fields."""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ═══ Feature Scores ═══════════════════════════════════════════

class FeatureScoresOut(_CamelModel):
    graph: float = 0
    behavioral: float = 0
    device: float = 0
    dead_account: float = 0
    velocity: float = 0


# ═══ Triggered Rule ═══════════════════════════════════════════

class TriggeredRuleOut(_CamelModel):
    severity: str = "INFO"       # "CRITICAL" | "WARNING" | "INFO"
    rule: str = ""
    detail: str = ""
    score_impact: float = 0


# ═══ Geo Evidence ═════════════════════════════════════════════

class GeoPointOut(_CamelModel):
    city: str = ""
    lat: float = 0
    lng: float = 0


class GeoEvidenceOut(_CamelModel):
    device_geo: GeoPointOut = Field(default_factory=GeoPointOut)
    ip_geo: GeoPointOut = Field(default_factory=GeoPointOut)
    distance_km: float = 0
    time_delta_min: float = 0
    speed_kmh: float = 0
    is_impossible: bool = False


# ═══ Behavioral Signature ═════════════════════════════════════

class BehavioralSignatureOut(_CamelModel):
    amount_entropy: float = 50
    fan_in_ratio: float = 25
    temporal_alignment: float = 80
    device_aging: float = 85
    network_diversity: float = 20
    velocity_burst: float = 15
    circadian_bitmask: float = 80
    isp_consistency: float = 85


# ═══ Probability Matrix Row ═══════════════════════════════════

class ProbabilityMatrixRowOut(_CamelModel):
    category: str = ""
    raw_value: str = "0"
    weight: float = 0
    weighted_score: float = 0
    scenario: str = ""


# ═══ Transaction (full frontend shape) ════════════════════════

class TransactionOut(_CamelModel):
    id: str
    timestamp: datetime
    sender_name: str = ""
    sender_upi: str = Field(default="", alias="senderUPI")
    receiver_name: str = ""
    receiver_upi: str = Field(default="", alias="receiverUPI")
    amount: float = 0
    status: str = "SUCCESS"        # "SUCCESS" | "FAILED" | "BLOCKED"
    risk_score: float = 0
    latency_ms: float = 0
    sender_ip: str = Field(default="", alias="senderIP")
    device_id: str = Field(default="", alias="deviceId")
    city: str = ""
    features: FeatureScoresOut = Field(default_factory=FeatureScoresOut)
    triggered_rules: List[TriggeredRuleOut] = Field(default_factory=list)
    geo_evidence: GeoEvidenceOut = Field(default_factory=GeoEvidenceOut)
    behavioral_signature: BehavioralSignatureOut = Field(default_factory=BehavioralSignatureOut)
    semantic_alert: str = ""
    probability_matrix: List[ProbabilityMatrixRowOut] = Field(default_factory=list)


# ═══ System Health ════════════════════════════════════════════

class Neo4jHealthOut(_CamelModel):
    active_connections: int = 0
    idle_connections: int = 0
    avg_query_ms: float = 0
    nodes_count: int = 0
    rels_count: int = 0


class RedisHealthOut(_CamelModel):
    stream_depth: int = 0
    lag_ms: float = 0
    memory_used_mb: float = Field(default=0, alias="memoryUsedMB")
    pending_messages: int = 0


class WorkersHealthOut(_CamelModel):
    active: int = 0
    total: int = 8
    cpu_percent: float = 0
    ram_percent: float = 0
    processed_per_sec: float = 0
    ws_connections: int = 0


class GraphAnalyticsHealthOut(_CamelModel):
    modularity: float = 0
    clusters: int = 0
    bfs_latency_ms: float = 0


class RedisWindowOut(_CamelModel):
    window_sec: int = 60
    events_in_window: int = 0


class SystemHealthOut(_CamelModel):
    neo4j: Neo4jHealthOut = Field(default_factory=Neo4jHealthOut, alias="neo4j")
    redis: RedisHealthOut = Field(default_factory=RedisHealthOut)
    workers: WorkersHealthOut = Field(default_factory=WorkersHealthOut)
    tps: float = 0
    mean_latency_ms: float = 0
    uptime: str = "0h 0m"
    graph_analytics: GraphAnalyticsHealthOut = Field(default_factory=GraphAnalyticsHealthOut)
    redis_window: RedisWindowOut = Field(default_factory=RedisWindowOut)


# ═══ Graph Node ═══════════════════════════════════════════════

class GraphNodeOut(_CamelModel):
    id: str
    name: str = ""
    upi: str = ""
    type: str = "user"             # "user" | "mule" | "aggregator"
    risk_score: float = 0
    fan_in: int = 0
    fan_out: int = 0
    betweenness_centrality: float = 0
    page_rank: float = 0
    device_count: int = 1
    city: str = ""
    last_active: datetime = Field(default_factory=datetime.utcnow)
    is_flagged: bool = False
    is_blocked: bool = False
    cluster: Optional[int] = None
    cycle_detected: bool = False
    local_cluster_coeff: float = 0


# ═══ Graph Edge ═══════════════════════════════════════════════

class GraphEdgeOut(_CamelModel):
    source: str
    target: str
    amount: float = 0
    count: int = 1
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    is_3_hop: bool = False


# ═══ Graph Network Response ═══════════════════════════════════

class GraphNetworkOut(_CamelModel):
    nodes: List[GraphNodeOut] = Field(default_factory=list)
    edges: List[GraphEdgeOut] = Field(default_factory=list)


# ═══ Subgraph (3-hop) ════════════════════════════════════════

class SubgraphNodeOut(_CamelModel):
    id: str
    name: str = ""
    upi: str = ""
    level: int = 0                 # 0 | 1 | 2 | 3
    type: str = "user"             # "user" | "mule" | "aggregator"
    risk_score: float = 0
    city: str = ""
    device_count: int = 1
    fan_in: int = 0
    fan_out: int = 0


class SubgraphEdgeOut(_CamelModel):
    source: str
    target: str
    amount: float = 0
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    level: int = 1                 # 1 | 2 | 3
    velocity: float = 0


class RealtimeSubgraphOut(_CamelModel):
    tx_id: str = ""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    nodes: List[SubgraphNodeOut] = Field(default_factory=list)
    edges: List[SubgraphEdgeOut] = Field(default_factory=list)
    reachability_score: float = 0
    circularity_index: float = 0
    hop_adjusted_velocity: float = 0
    cycle_detected: bool = False
    cycle_nodes: List[str] = Field(default_factory=list)
    network_path_velocity_min: float = 60
    betweenness_centrality: float = 0
    geo_ip_convergence: float = 0
    identity_density: float = 1


# ═══ Aggregator Node ══════════════════════════════════════════

class AggregatorNodeOut(_CamelModel):
    id: str
    name: str = ""
    upi: str = ""
    betweenness_centrality: float = 0
    page_rank: float = 0
    fan_in: int = 0
    fan_out: int = 0
    total_volume: float = 0
    risk_score: float = 0
    flagged_at: datetime = Field(default_factory=datetime.utcnow)
    cluster: int = 0
    device_count: int = 1


# ═══ ASN Entry ════════════════════════════════════════════════

class ASNEntryOut(_CamelModel):
    asn: str = ""
    provider: str = ""
    tx_count: int = 0
    risk_tx_count: int = 0
    percentage: float = 0
    is_risky: bool = False


# ═══ Device Cluster ═══════════════════════════════════════════

class DeviceClusterOut(_CamelModel):
    device_id: str
    user_count: int = 0
    users: List[str] = Field(default_factory=list)
    first_seen: datetime = Field(default_factory=datetime.utcnow)
    last_seen: datetime = Field(default_factory=datetime.utcnow)
    risk_score: float = 0


# ═══ AI Analysis ══════════════════════════════════════════════

class AIIssueOut(_CamelModel):
    severity: str = "info"         # "critical" | "warning" | "info"
    title: str = ""
    explanation: str = ""


class AIAnalysisResultOut(_CamelModel):
    summary: str = ""
    risk_verdict: str = ""
    issues: List[AIIssueOut] = Field(default_factory=list)
    possibilities: List[str] = Field(default_factory=list)
    recommendation: str = ""


# ═══ Latency Bucket ═══════════════════════════════════════════

class LatencyBucketOut(_CamelModel):
    index: int = 0
    latency_ms: float = 0
    timestamp: datetime = Field(default_factory=datetime.utcnow)
