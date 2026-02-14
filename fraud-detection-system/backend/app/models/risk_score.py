"""
Risk score models and response structures.
Used by the risk fusion engine and the API layer.
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime
from enum import Enum


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class RiskBreakdown(BaseModel):
    """Weighted sub-score breakdown (each 0-100)."""
    graph: float = Field(0.0, ge=0, le=100)
    behavioral: float = Field(0.0, ge=0, le=100)
    device: float = Field(0.0, ge=0, le=100)
    dead_account: float = Field(0.0, ge=0, le=100)
    velocity: float = Field(0.0, ge=0, le=100)


class RiskResponse(BaseModel):
    """Final risk assessment pushed to the dashboard."""
    tx_id: str
    risk_score: float = Field(ge=0, le=100)
    risk_level: RiskLevel
    breakdown: RiskBreakdown
    cluster_id: Optional[str] = None
    flags: List[str] = []
    reason: str = Field("", description="Human-readable explainability string")
    processing_time_ms: float = 0.0
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ClusterInfo(BaseModel):
    """Fraud cluster (community) information."""
    cluster_id: str
    member_count: int
    avg_risk: float
    density: float
    risk_level: RiskLevel
    members: List[str] = []
    detected_at: datetime = Field(default_factory=datetime.utcnow)
    algorithm: str = "louvain"


class AlertInfo(BaseModel):
    """Real-time alert pushed via WebSocket."""
    alert_id: str = Field(default_factory=lambda: str(__import__("uuid").uuid4()))
    tx_id: str
    alert_type: str
    risk_score: float
    risk_level: RiskLevel
    sender_id: str
    receiver_id: str
    amount: float
    flags: List[str]
    cluster_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class DashboardStats(BaseModel):
    """Aggregate statistics for the dashboard header."""
    total_transactions: int = 0
    flagged_transactions: int = 0
    high_risk_count: int = 0
    active_clusters: int = 0
    avg_risk_score: float = 0.0
    avg_processing_time_ms: float = 0.0
    tps: float = 0.0
    total_amount_processed: float = 0.0
    top_flags: List[Dict[str, int]] = []
