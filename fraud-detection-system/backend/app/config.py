"""
Application configuration.
Loads settings from environment variables with sensible defaults.
"""

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Central configuration for the Fraud Detection Engine."""

    # ── Application ─────────────────────────────────────────
    APP_NAME: str = "Real-Time Mule & Collusive Fraud Intelligence Engine"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = True
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # ── Neo4j ───────────────────────────────────────────────
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "password123"
    NEO4J_DATABASE: str = "neo4j"
    NEO4J_MAX_POOL_SIZE: int = 50

    # ── Redis ───────────────────────────────────────────────
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0

    # Inbound stream — raw UPI gateway payloads land here
    REDIS_UPI_STREAM_KEY: str = "upi_raw"
    REDIS_UPI_CONSUMER_GROUP: str = "upi_adapter"
    REDIS_UPI_ADAPTER_WORKERS: int = 2

    # Processing stream — validated & enriched payloads for fraud scoring
    REDIS_STREAM_KEY: str = "fraud_queue"
    REDIS_CONSUMER_GROUP: str = "fraud_workers"
    REDIS_ALERTS_CHANNEL: str = "fraud_alerts"

    # ── Worker Pool ─────────────────────────────────────────
    WORKER_COUNT: int = 4
    WORKER_BATCH_SIZE: int = 10

    # ── Graph Analytics (batch interval) ────────────────────
    GRAPH_ANALYTICS_INTERVAL_SEC: int = 5

    # ── Risk Fusion Weights ─────────────────────────────────
    WEIGHT_GRAPH: float = 0.30
    WEIGHT_BEHAVIORAL: float = 0.25
    WEIGHT_DEVICE: float = 0.20
    WEIGHT_DEAD_ACCOUNT: float = 0.15
    WEIGHT_VELOCITY: float = 0.10

    # ── Risk Thresholds ─────────────────────────────────────
    HIGH_RISK_THRESHOLD: float = 70.0
    MEDIUM_RISK_THRESHOLD: float = 40.0

    # ── Feature Parameters ──────────────────────────────────
    MMDB_PATH: str = "asn_ipv4_small.mmdb/asn_ipv4_small.mmdb"
    DORMANT_DAYS_THRESHOLD: int = 30
    DEVICE_ACCOUNT_THRESHOLD: int = 5
    VELOCITY_WINDOW_SEC: int = 60
    BEHAVIORAL_HISTORY_COUNT: int = 25
    PASS_THROUGH_RATIO_THRESHOLD: float = 0.80
    BURST_TX_THRESHOLD: int = 10
    IMPOSSIBLE_TRAVEL_KMH: float = 250.0
    NIGHT_START_HOUR: int = 23
    NIGHT_END_HOUR: int = 5

    # ── New Feature Parameters (v2 schema) ──────────────────
    # Device drift
    CAPABILITY_MASK_CHANGE_WEIGHT: float = 10.0

    # New device risk
    NEW_DEVICE_HIGH_AMOUNT_THRESHOLD: float = 10000.0
    NEW_DEVICE_PENALTY: float = 12.0

    # SIM-swap multi-account device detection
    DEVICE_MULTI_USER_THRESHOLD: int = 3
    DEVICE_MULTI_USER_WINDOW_HOURS: int = 24
    DEVICE_MULTI_USER_PENALTY: float = 25.0

    # IP rotation
    IP_ROTATION_WINDOW_HOURS: int = 24
    IP_ROTATION_MAX_UNIQUE: int = 5
    IP_ROTATION_PENALTY: float = 15.0

    # Fixed-amount pattern detection
    FIXED_AMOUNT_TOLERANCE: float = 0.01
    FIXED_AMOUNT_MIN_COUNT: int = 3
    FIXED_AMOUNT_PENALTY: float = 10.0

    # Circadian anomaly (unusual transaction hour)
    CIRCADIAN_ANOMALY_PENALTY: float = 20.0
    CIRCADIAN_NEW_DEVICE_PENALTY: float = 35.0

    # Transaction identicality index (same amount, same receiver)
    TX_IDENTICALITY_WINDOW_HOURS: int = 1
    TX_IDENTICALITY_MIN_COUNT: int = 3
    TX_IDENTICALITY_PENALTY: float = 30.0

    # Sleep-and-flash mule (woken mule detection)
    SLEEP_FLASH_RATIO_THRESHOLD: float = 50.0
    SLEEP_FLASH_DORMANT_DAYS: int = 30

    # Geo-IP distance anomaly (km)
    GEO_IP_DISTANCE_THRESHOLD_KM: float = 500.0

    # Simulation ──────────────────────────────────────────
    SIMULATION_TPS: int = 500
    SIMULATION_TOTAL_TX: int = 10000
    SIMULATION_USER_COUNT: int = 20       # must match seed_data.py (20 users)
    SIMULATION_MULE_RATIO: float = 0.15   # 3 mules out of 20 = 15%
    SIMULATION_DEVICE_COUNT: int = 15     # must match seed_data.py (15 devices)

    model_config = {"env_file": ".env", "case_sensitive": True}


settings = Settings()
