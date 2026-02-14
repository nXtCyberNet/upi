# Real-Time Mule & Collusive Fraud Intelligence Engine

A graph-powered, real-time UPI fraud detection system built for India’s Unified Payments Interface ecosystem.

**Performance Targets**

* 500 transactions per second (TPS)
* < 200 ms per-transaction scoring latency

Combines Neo4j graph analytics, Redis Streams ingestion, behavioural profiling, Indian IPv4 ASN intelligence (MMDB-backed), device fingerprinting, and six GDS algorithms into a single weighted fusion risk score with full explainability.

---

# Table of Contents

1. Architecture Overview
2. System Data Flow
3. Neo4j Graph Schema
4. Risk Fusion Engine
5. Behavioural Intelligence
6. Graph Intelligence
7. Device Risk
8. Dead Account Detection
9. Velocity & Pass-Through
10. Indian IPv4 ASN Intelligence (8-Step Pipeline)
11. Collusive Fraud Detection (Batch)
12. Mule Account Classification
13. Graph Data Science Algorithms (Batch)
14. Explainability Engine
15. Anomaly Detection Primitives
16. Evaluation Metrics
17. API Reference
18. WebSocket Real-Time Alerts
19. Configuration Reference
20. Deployment Guide
21. Project Structure
22. Privacy & Compliance (DPDP Act)

---

# 1. Architecture Overview

```
                         ┌──────────────────────────────────────────┐
                         │           UPI Gateway / API              │
                         │         POST /api/transaction            │
                         └──────────┬───────────────────────────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │     Redis Streams    │
                         │  (transactions queue)│
                         └─────┬────────────────┘
                               │
               ┌───────────────┼────────────────┐
               │               │                │
               ▼               ▼                ▼
        ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
        │   Worker 0  │ │   Worker 1  │ │   Worker N  │
        │  ┌────────┐ │ │             │ │             │
        │  │ Ingest │ │ │     ...     │ │     ...     │
        │  │(Neo4j) │ │ │             │ │             │
        │  ├────────┤ │ │             │ │             │
        │  │MMDB ASN│ │ │             │ │             │
        │  │Resolve │ │ │             │ │             │
        │  ├────────┤ │ │             │ │             │
        │  │  Risk  │ │ │             │ │             │
        │  │ Engine │ │ │             │ │             │
        │  └────────┘ │ │             │ │             │
        └─────────────┘ └─────────────┘ └─────────────┘
               │
               ▼
        ┌───────────────────────────────────────────────┐
        │                Neo4j (GDS)                    │
        │  :User  :Device  :IP  :Transaction  :Cluster  │
        └───────────────────────────────────────────────┘
               │
               ▼
        ┌──────────────────────────────────────┐
        │   Background Graph Analyzer (5s)    │
        │ • Louvain  • Betweenness            │
        │ • PageRank • Clustering Coeff       │
        │ • WCC      • Collusive Detection    │
        │ • User Stats Aggregation            │
        │ • Device Count Refresh              │
        │ • Dormant Account Flagging          │
        └──────────────────────────────────────┘
               │
               ▼
        ┌──────────────────────────────────────┐
        │   WebSocket ws://host/ws/alerts     │
        │   (real-time dashboard push)        │
        └──────────────────────────────────────┘
```

---

# Technology Stack

| Layer            | Technology              | Purpose                        |
| ---------------- | ----------------------- | ------------------------------ |
| API              | FastAPI + Uvicorn       | REST endpoints + WebSocket     |
| Queue            | Redis 7 Streams         | Transaction ingestion pipeline |
| Graph DB         | Neo4j 5.15 + GDS Plugin | Graph storage + algorithms     |
| ASN Intelligence | MaxMind MMDB (local)    | Indian IPv4 classification     |
| Computation      | NumPy, SciPy            | Statistical scoring            |
| Models           | Pydantic v2             | Validation + settings          |
| Containerisation | Docker Compose          | Orchestration                  |

---

# 2. System Data Flow

## Hot Path (< 200 ms)

Transaction → Redis XADD
→ Worker XREADGROUP
→ Ingest into Neo4j (MATCH-based, lock-free)
→ MMDB ASN Resolve
→ 5 Parallel Feature Extractors
→ Weighted Risk Fusion
→ Write-back Risk
→ WebSocket Alert (risk ≥ 40)
→ Redis ACK

## Deadlock Mitigation Strategy

_MAX_RETRIES = 3
_BASE_BACKOFF_SEC = 0.02

Exponential backoff with jitter:

```
backoff = 0.02 * (2 ** attempt) + random(0, 0.01)
```

---

# 3. Neo4j Graph Schema

## Node Labels

| Label        | Key Property         | Description               |
| ------------ | -------------------- | ------------------------- |
| :User        | user_id (UNIQUE)     | UPI account holder        |
| :Device      | device_hash (UNIQUE) | Device fingerprint        |
| :IP          | ip_address (UNIQUE)  | IP node with ASN metadata |
| :Transaction | tx_id (UNIQUE)       | Individual transaction    |
| :Cluster     | cluster_id (UNIQUE)  | Fraud community cluster   |

---

# 4. Risk Fusion Engine

## Master Formula

R = min(
w_g S_graph +
w_b S_behavioral +
w_d S_device +
w_a S_dead_account +
w_v S_velocity,
100
)

Each sub-score S_i ∈ [0, 100]

## Default Weights

| Component          | Weight | Rationale                |
| ------------------ | ------ | ------------------------ |
| Graph Intelligence | 0.30   | Strongest mule indicator |
| Behavioural        | 0.25   | Amount + geo anomalies   |
| Device Risk        | 0.20   | Shared/emulator patterns |
| Dead Account       | 0.15   | Dormant activation       |
| Velocity           | 0.10   | Burst detection          |

---

# 5. Behavioural Intelligence

## Amount Z-Score (UPI Only)

z = (A_t - mean_25) / std_25

## Impossible Travel

Speed = distance_km / (delta_time / 3600)
Flag if Speed > 250 km/h

## Mahalanobis Distance

D_M(x) = sqrt((x - μ)^T Σ⁻¹ (x - μ))

## Behavioural Risk

S_behavioral = min(sum(points_i), 100)

---

# 10. Indian IPv4 ASN Intelligence

## ASN Density

ASN_density_norm = min( ln(1 + N) / 6.909 , 1 )

## ASN Entropy

H_ASN = -Σ p_i ln(p_i)
H_norm = min(H / 2.5, 1)

## Final ASN Risk

ASN_risk = clamp(
0.4 ASN_base +
0.3 ASN_density_norm +
0.2 ASN_drift +
0.2 ForeignFlag +
0.1 H_norm,
0, 1
)

ASN_risk_scaled = ASN_risk × 20

---

# 13. Graph Data Science (Batch)

## Louvain Modularity

Q = (1 / 2m) Σ [ A_ij - (k_i k_j / 2m) ] δ(c_i, c_j)

## Betweenness Centrality

g(v) = Σ (σ_st(v) / σ_st)

## PageRank

PR(v) = (1-d)/N + d Σ PR(u)/L(u)

---

# 16. Evaluation Metrics

F1 = 2PR / (P + R)

---

# 21. Project Structure

```
fraud-detection-system/
├── README.md
├── backend/
│   ├── docker-compose.yml
│   ├── requirements.txt
│   └── app/
│       ├── config.py
│       ├── main.py
│       ├── neo4j_manager.py
│       ├── api/
│       ├── core/
│       ├── detection/
│       ├── features/
│       ├── models/
│       └── utils/
├── scripts/
└── frontend/
```

---

Built for the Indian UPI ecosystem.
Designed for sustained 500 TPS.
Every transaction scored under 200 ms.
