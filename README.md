# Real-Time Mule & Collusive Fraud Intelligence Engine

> **A graph-powered, real-time UPI fraud detection system built for India's Unified Payments Interface ecosystem.**
>
> Processes **500 TPS** with **< 200 ms scoring latency**, combining Neo4j graph analytics, Redis Streams, behavioural profiling, Indian IPv4 ASN intelligence, device fingerprinting, and 6 GDS algorithms into a single weighted fusion risk score with full explainability.
>
> 📐 **[Detailed mathematical foundations & algorithm derivations → APPROACH.md](fraud-detection-system/APPROACH.md)**

---

## Table of Contents

1. [What's New in v3](#1-whats-new-in-v3)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [System Data Flow](#4-system-data-flow)
5. [Neo4j Graph Schema](#5-neo4j-graph-schema)
6. [Risk Fusion Engine](#6-risk-fusion-engine)
7. [Feature Extractors](#7-feature-extractors)
8. [Collusive Fraud Detection](#8-collusive-fraud-detection)
9. [Mule Account Classification](#9-mule-account-classification)
10. [Explainability Engine](#10-explainability-engine)
11. [Real-Time Dashboard](#11-real-time-dashboard)
12. [API Reference](#12-api-reference)
13. [WebSocket Real-Time Alerts](#13-websocket-real-time-alerts)
14. [Configuration Reference](#14-configuration-reference)
15. [Deployment Guide](#15-deployment-guide)
16. [Project Structure](#16-project-structure)
17. [Privacy & Compliance (DPDP Act)](#17-privacy--compliance-dpdp-act)

---

## 1. What's New in v3

### 🔴 New Fraud Detection Signals

| Signal | Domain | Description |
| ------ | ------ | ----------- |
| **SIM-Swap Multi-User** | Device | >3 distinct users on same device within 24h → SIM-swap indicator |
| **Circadian Anomaly** | Behavioural | Transaction at an hour representing <2% of user's history |
| **TX Identicality Index** | Behavioural | ≥3 identical-amount transfers to same receiver within 1h (structuring) |
| **Sleep-and-Flash Mule** | Dead Account | Dormant >30 days + amount ≥50× historical average |
| **Device Drift** | Device | OS family change + capability mask Hamming distance |
| **New Device + MPIN** | Device | Unseen device + high amount (≥₹10K) + MPIN auth compound |
| **Circadian + New Device** | Compound | Amplified penalty (35 pts vs 20 pts) when both triggers fire |

### ❌ Removed Weak Signals

| Signal | Reason |
| ------ | ------ |
| Mahalanobis distance | Unstable for N < 30; replaced by IQR outlier (works with N ≥ 4) |
| App version / downgrade | Banks/NPCI force updates; if app is open, it's compliant |
| SIM verification flag | Removed from schema |
| `is_emulator` field | Removed from DeviceInfo model |

### 🖥️ New Dashboard Features

| Feature | Description |
| ------- | ----------- |
| **Risk-Based Transaction Filtering** | Filter pills (Flagged / High / Medium / Normal / All) with animated transitions |
| **LRU Buffer** | Smart memory management — 200 flagged + 50 normal transactions retained |
| **Virtual Scrolling** | `@tanstack/react-virtual` kicks in at 100+ items for buttery 60fps |
| **Keyboard Shortcuts** | `1` High · `2` Medium · `3` Normal · `A` All · `F` Flagged |
| **Persistent Filters** | Filter preference saved to `localStorage`, restored on reload |
| **Contextual Empty States** | Per-filter-mode messages with "Show flagged instead" fallback |
| **Live WebSocket Stream** | Real-time transaction feed over `ws://host/ws/alerts` |
| **Interactive Graph Explorer** | D3 force-directed fraud network with node drawer |
| **Geodesic Arc Map** | Leaflet-based geographic transaction flow visualization |
| **Behavioural Radar** | Multi-axis radar chart for user behavioural profiling |
| **Mule Management Panel** | Classified mule accounts with confidence scores |

---

## 2. Architecture Overview

```
                               ┌──────────────────────────────────────────┐
                               │            UPI Gateway / API             │
                               │          POST /api/transaction           │
                               └───────────────┬──────────────────────────┘
                                               │
                                               ▼
                               ┌──────────────────────────────────────────┐
                               │              Redis Streams               │
                               │   Ordered ingestion · Backpressure       │
                               └───────────────┬──────────────────────────┘
                                               │
                        ┌──────────────────────┼──────────────────────┐
                        ▼                      ▼                      ▼
               ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
               │   Worker 0     │     │   Worker 1     │     │   Worker N     │
               │  Ingest → ASN  │     │      ...       │     │      ...       │
               │  → Risk Score  │     │                │     │                │
               └────────────────┘     └────────────────┘     └────────────────┘
                        │                      │                      │
                        └──────────────────────┴──────────────────────┘
                                               │
                                               ▼
       ┌────────────────────────────────────────────────────────────────────┐
       │                         Neo4j Graph Database                       │
       │  :User  :Device  :IP  :Transaction  :Cluster                      │
       │  Real-time writes · Indexed identities · Graph projections        │
       └───────────────────────────┬────────────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                              ▼
       ┌────────────────────────┐    ┌──────────────────────────────────┐
       │  Background GDS (5s)  │    │  Real-Time Alerting Layer        │
       │  Louvain · PageRank   │    │  WebSocket: ws://host/ws/alerts  │
       │  Betweenness · WCC    │    │  Risk ≥ 40 → Push to Dashboard  │
       │  Collusive Detection  │    └──────────────────────────────────┘
       └────────────────────────┘
                    │
                    ▼
       ┌────────────────────────────────────────────────────────────────────┐
       │                    Next.js Dashboard (Port 3001)                   │
       │  Transaction Stream · Graph Explorer · Intelligence Panel         │
       │  Mule Management · Risk Gauges · Geodesic Map · Behavioural Radar │
       └────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **API** | FastAPI + Uvicorn | REST endpoints + WebSocket |
| **Queue** | Redis 7 Streams | Transaction ingestion pipeline (consumer groups) |
| **Graph DB** | Neo4j 5.25 + GDS v2.12.0 | Transaction graph, feature reads, batch algorithms |
| **ASN Intelligence** | MaxMind MMDB (local) | Indian IPv4 ASN classification (offline, no API calls) |
| **Computation** | NumPy, SciPy | Statistical features (z-score, IQR outlier, rolling stats) |
| **Models** | Pydantic v2 | Request/response validation, settings management |
| **Frontend** | Next.js 16 + React 19 | Real-time dashboard with Turbopack |
| **Visualization** | D3, Recharts, Leaflet | Graph explorer, charts, geodesic maps |
| **Animations** | Framer Motion | Filter transitions, list animations |
| **Virtual Scroll** | @tanstack/react-virtual | 60fps scrolling for large transaction lists |
| **Containerisation** | Docker Compose | Neo4j + Redis orchestration |

### Performance Targets

| Metric | Target | Mechanism |
|--------|--------|-----------|
| **Throughput** | 500 TPS | 4 async workers × batch Redis reads × lock-free Neo4j ingest |
| **Scoring Latency** | < 200 ms | 5 extractors run concurrently via `asyncio.gather()` |
| **Deadlock Rate** | ≈ 0 | MATCH-based ingest (not MERGE), exponential backoff retry |
| **Batch Cycle** | Every 5 s | GDS algorithms + aggregation run outside hot path |
| **Dashboard FPS** | 60 fps | Virtual scrolling at 100+ items, LRU buffer caps memory |

---

## 4. System Data Flow

### Hot Path (Per Transaction · < 200 ms)

```
Incoming Transaction
    → Redis XADD
    → Worker XREADGROUP
    → Graph Ingestion (Neo4j MATCH-based write)
    → IPv4 ASN Resolution (local MMDB)
    → 5 Concurrent Risk Extractors (asyncio.gather)
    → Weighted Fusion Engine → RiskResponse (0–100)
    → Risk Write-Back (fire-and-forget)
    → WebSocket Alert (if risk ≥ 40)
    → Redis Stream ACK
```

### Cold Path (Graph Intelligence Loop · Every 5s)

```
GraphAnalyzer._loop()
    → Batch update user stats (avg, std, count)
    → Batch update device stats
    → Flag dormant accounts (>30 days)
    → GDS projection (drop + create)
    → Louvain → Betweenness → PageRank → Local Clustering
    → CollusiveFraudDetector.refresh() (6 pattern queries)
```

### Deadlock Mitigation

- **Strategy:** Exponential backoff (20ms base) with random jitter
- **Max retries:** 3
- **ACK policy:** Only after successful write + scoring

---

## 5. Neo4j Graph Schema

### Node Labels

| Label | Key Property | Description |
|-------|-------------|-------------|
| `:User` | `user_id` (UNIQUE) | UPI account holder |
| `:Device` | `device_hash` (UNIQUE) | Device fingerprint |
| `:IP` | `ip_address` (UNIQUE) | IP address node with ASN metadata |
| `:Transaction` | `tx_id` (UNIQUE) | Individual UPI transaction |
| `:Cluster` | `cluster_id` (UNIQUE) | Fraud community cluster |

### Relationship Types

| Relationship | Pattern | Properties |
|-------------|---------|------------|
| `:SENT` | `(User)-[:SENT]->(Transaction)` | — |
| `:RECEIVED_BY` | `(Transaction)-[:RECEIVED_BY]->(User)` | — |
| `:USES_DEVICE` | `(User)-[:USES_DEVICE]->(Device)` | — |
| `:ACCESSED_FROM` | `(User)-[:ACCESSED_FROM]->(IP)` | — |
| `:TRANSFERRED_TO` | `(User)-[:TRANSFERRED_TO]->(User)` | `total_amount`, `tx_count`, `last_tx` |
| `:MEMBER_OF` | `(User)-[:MEMBER_OF]->(Cluster)` | — |

### Key User Properties

| Property | Source | Description |
|----------|--------|-------------|
| `avg_tx_amount`, `std_tx_amount` | Batch | Rolling transaction statistics |
| `tx_count`, `total_outflow` | Batch | Aggregate counts |
| `is_dormant` | Batch | True if inactive > 30 days |
| `risk_score` | Hot path | Latest fused risk score |
| `community_id` | GDS Louvain | Community assignment |
| `betweenness`, `pagerank` | GDS | Centrality measures |
| `clustering_coeff` | GDS | Local clustering coefficient |
| `component_id` | GDS WCC | Weakly Connected Component |

### Indexes

8 performance indexes on risk scores, timestamps, dormancy flags, device scores, cluster risk levels, and ASN lookups for sub-millisecond queries.

---

## 6. Risk Fusion Engine

### Weight Configuration

| Component | Weight | Role |
|-----------|--------|------|
| **Graph Intelligence** | 0.30 | Network topology — strongest mule signal |
| **Behavioural** | 0.25 | Amount anomaly + geo + ASN |
| **Device Risk** | 0.20 | Shared hardware patterns |
| **Dead Account** | 0.15 | Dormant reactivation |
| **Velocity** | 0.10 | Burst / pass-through timing |

### Risk Levels

| Level | Threshold | Action |
|-------|-----------|--------|
| **HIGH** | ≥ 70 | Immediate alert + block recommendation |
| **MEDIUM** | ≥ 40 | WebSocket alert + dashboard flag |
| **LOW** | < 40 | Log only |

All 5 extractors execute concurrently via `asyncio.gather()` for < 200ms latency.

> 📐 **Full fusion formula and sub-score derivations → [APPROACH.md](fraud-detection-system/APPROACH.md#1-risk-fusion-formula)**

---

## 7. Feature Extractors

### 7.1 Behavioural Intelligence (`app/features/behavioral.py`)

12 active signals across amount anomaly, temporal patterns, geographic analysis, and network intelligence.

| Signal | Max Points | Description |
|--------|-----------|-------------|
| Amount Z-Score | 30 | 3σ rule against user's rolling average |
| TX Identicality | 30 | ≥3 identical amounts to same receiver in 1h ✨ **v3** |
| Impossible Travel | 20 | Haversine velocity > 250 km/h |
| ASN Risk | 20 | 8-step pipeline: MMDB → classify → density → drift → entropy |
| Velocity | 20 | Burst detection within 60s window |
| Circadian Anomaly | 20/35 | Unusual hour (<2% of history); 35 if compound w/ new device ✨ **v3** |
| IQR Outlier | 15 | Robust outlier detection (replaced Mahalanobis) ✨ **v3** |
| Dormant Burst | 15 | Dormant account + amount > profile average |
| IP Rotation | 15 | >5 unique IPs in 24h |
| 3σ Spike | 10 | Amount exceeds mean + 3σ |
| Fixed-Amount | 10 | Repeated identical transfer amounts |
| Night Flag | 5 | Transaction between 23:00–05:00 |

### 7.2 Graph Intelligence (`app/features/graph_intelligence.py`)

Leverages precomputed GDS properties (refreshed every 5s):

| Component | Max Points | Source |
|-----------|-----------|--------|
| Community Risk | ~100 | Louvain clusters with avg risk > 50 |
| Centrality Score | 30 | Betweenness × 200 |
| Structural Patterns | 15 | Fan-out, fan-in, tight ring detection |
| Neighbour Contagion | 15 | First-degree fraud proximity |
| PageRank Score | 15 | Structural importance × 500 |

### 7.3 Device Risk (`app/features/device_risk.py`)

| Component | Max Points | Status |
|-----------|-----------|--------|
| Multi-Account Exposure | 40 | ≥5 accounts → 40 pts |
| Risk Propagation | 25 | Device base risk × 0.25 |
| SIM-Swap Multi-User | 25 | >3 users on device in 24h ✨ **v3** |
| Device Drift | 15 | OS family + capability mask changes ✨ **v3** |
| New Device + MPIN | 15 | Compound: unseen device + ≥₹10K + MPIN ✨ **v3** |
| New Device Penalty | 12 | Base penalty for first-seen device |
| High-Risk Bonus | 10 | Any device user has risk > 80 |
| OS Anomaly | 10 | Non-Android/iOS on UPI |

### 7.4 Dead Account Detection (`app/features/dead_account.py`)

| Component | Max Points | Status |
|-----------|-----------|--------|
| Inactivity Score | 30 | Scaled by days dormant / 30 |
| Spike Score | 30 | Amount / profile average |
| First-Strike Bonus | 25 | Dormant account's first transaction |
| Sleep-and-Flash | 20 | Amount ≥50× avg after ≥30 days dormant ✨ **v3** |
| Low Activity | 10 | ≤3 lifetime transactions |

### 7.5 Velocity & Pass-Through (`app/features/velocity.py`)

| Component | Max Points |
|-----------|-----------|
| Pass-Through Score | 35 |
| Burst Detection | 30 |
| Velocity Component | 20 |
| Single Transaction Ratio | 15 |

> 📐 **All scoring formulas, IQR derivations, Haversine equations, ASN 8-step pipeline → [APPROACH.md](fraud-detection-system/APPROACH.md)**

---

## 8. Collusive Fraud Detection

**Batch engine** running every 5 seconds with **O(1) hot-path lookup** via in-memory cache.

| Pattern | Description | Key Parameter |
|---------|-------------|---------------|
| **Fraud Islands** | Louvain clusters with ≥3 users & avg risk > 40 | `min_avg_risk=40` |
| **Money Routers** | High betweenness centrality nodes | `min_betweenness=0.01` |
| **Circular Flows** | A→B→C→A cycles within 7 days | Rolling window |
| **Rapid Chains** | 2–4 hop transfers < 300s gap | Layered timing |
| **Star Hubs** | High fan-in / fan-out structures | Degree ≥ 5 |
| **Relay Mules** | Outflow/inflow > 0.75 within 10 min | Flow ratio |

---

## 9. Mule Account Classification

**Per-transaction evaluation** producing `{is_mule, confidence, reasons}`.

**17 active signals** with scores from +0.05 to +0.30, accumulated and capped at 1.0.

**Top signals:** First-strike dormant (+0.30) · Dormant activation (+0.25) · Sleep-and-flash (+0.25) · High pass-through (+0.20) · SIM-swap (+0.20)

**Classification rule:** `is_mule = (score ≥ 0.5) OR (risk_fused ≥ 65)`

---

## 10. Explainability Engine

Every flagged transaction includes a human-readable reason string built from **22 condition rules**.

**Example output:**
> "Account activated after 45 days of inactivity. Sleep-and-flash mule: amount 62x above historical avg, dormant >30d. SIM-swap: 4 users on same device in 24h. Circadian anomaly: transaction at unusual hour for this user."

---

## 11. Real-Time Dashboard

Built with **Next.js 16** (Turbopack) on port 3001, proxying API calls to the FastAPI backend on port 8000.

### Dashboard Views

| Tab | Components |
|-----|-----------|
| **Pulse View** | Transaction Stream (left) + Risk Gauge + Latency Heatmap + Charts (right) |
| **Graph Explorer** | D3 force-directed fraud network + Node Drawer with user details |
| **Intelligence** | Behavioural Radar + Geodesic Arc Map + Probability Matrix + Transaction Stream |
| **Mule Management** | Classified mule accounts with confidence scores and evidence |

### Transaction Stream Features

- **Risk Filter Pills** — Animated pill buttons (Flagged / High / Medium / Normal / All) with spring transitions and count badges
- **LRU Memory Buffer** — Retains last 200 flagged + 50 normal transactions to prevent memory bloat
- **300ms Debounced Filtering** — Prevents jank during rapid filter switches
- **Virtual Scrolling** — `@tanstack/react-virtual` activates at 100+ items (60px estimated row height, 10-item overscan)
- **Keyboard Shortcuts** — `1` High · `2` Medium · `3` Normal · `A` All · `F` Flagged
- **localStorage Persistence** — Selected filter mode survives page reloads
- **Contextual Empty States** — Per-filter-mode messages with "Show flagged instead" fallback button
- **Live Search** — Filter by transaction ID, sender, or receiver on top of risk filtering
- **Freeze/Resume** — Pause the live stream for inspection without losing data

### Key Frontend Components

```
src/
├── app/
│   ├── page.tsx                    # Main dashboard with 4 tabs
│   └── layout.tsx                  # Root layout
├── hooks/
│   ├── useRealStream.ts            # WebSocket + REST data hook
│   └── useFilteredTransactions.ts  # LRU buffer + debounce + keyboard shortcuts
├── components/
│   ├── stream/
│   │   ├── TransactionStream.tsx   # Virtual-scrolled transaction list
│   │   └── TransactionFilter.tsx   # Animated filter pills
│   ├── graph/
│   │   ├── GraphExplorer.tsx       # D3 force-directed graph
│   │   └── NodeDrawer.tsx          # User detail drawer
│   ├── intelligence/
│   │   ├── BehavioralRadar.tsx     # Multi-axis radar chart
│   │   ├── GeodesicArcMap.tsx      # Leaflet geographic flow map
│   │   ├── ProbabilityMatrix.tsx   # Risk probability heatmap
│   │   └── IntelligencePanel.tsx   # Unified intelligence view
│   ├── gauges/
│   │   ├── RiskGauge.tsx           # Animated risk score gauge
│   │   └── LatencyHeatmap.tsx      # Processing latency visualization
│   ├── charts/
│   │   └── Charts.tsx              # Recharts-based analytics
│   └── mule/
│       └── MuleManagement.tsx      # Mule account management
└── lib/
    ├── api.ts                      # API client with timeout handling
    ├── types.ts                    # TypeScript interfaces
    └── utils.ts                    # Risk helpers, formatINR, colors
```

---

## 12. API Reference

**Base URL:** `http://localhost:8000/api`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service + DB health |
| POST | `/transaction` | Score single transaction |
| GET | `/dashboard/stats` | Aggregate statistics |
| GET | `/viz/fraud-network` | Graph nodes + edges (min_risk=45) |
| GET | `/viz/device-sharing` | Device clusters |
| GET | `/detection/collusive` | Collusion summary |
| GET | `/analytics/status` | Batch analytics status |
| GET | `/db/counts` | Graph counts |

### POST /api/transaction — Request

```json
{
  "tx_id": "uuid",
  "sender_id": "U0001",
  "receiver_id": "U0042",
  "amount": 15000.0,
  "timestamp": "2026-02-12T14:30:00",
  "device_hash": "DEV0001",
  "device_os": "Android 14",
  "ip_address": "49.36.128.42",
  "sender_lat": 19.076,
  "sender_lon": 72.8777,
  "channel": "UPI",
  "upi_id_sender": "user1@upi",
  "upi_id_receiver": "user42@upi"
}
```

### POST /api/transaction — Response

```json
{
  "tx_id": "a1b2c3d4",
  "risk_score": 72.5,
  "risk_level": "HIGH",
  "breakdown": {
    "graph": 45.0,
    "behavioral": 62.0,
    "device": 35.0,
    "dead_account": 80.0,
    "velocity": 28.0
  },
  "cluster_id": "42",
  "flags": ["First-Strike Dormant", "ASN Hosting"],
  "reason": "Dormant activation with high ASN risk",
  "processing_time_ms": 87.3,
  "timestamp": "2026-02-12T14:30:00"
}
```

---

## 13. WebSocket Real-Time Alerts

**URL:** `ws://localhost:8000/ws/alerts`

- Broadcast when risk ≥ 40
- Payload identical to RiskResponse
- Dead connections pruned automatically
- Dashboard auto-reconnects with exponential backoff

---

## 14. Configuration Reference

All parameters overrideable via environment variables. **File:** `app/config.py`

### Core

| Variable | Default |
|----------|---------|
| `HOST` | 0.0.0.0 |
| `PORT` | 8000 |
| `NEO4J_URI` | bolt://localhost:7687 |
| `NEO4J_MAX_POOL_SIZE` | 50 |
| `REDIS_STREAM_KEY` | transactions |
| `WORKER_COUNT` | 4 |
| `WORKER_BATCH_SIZE` | 10 |

### Risk Weights (sum = 1.0)

| Variable | Default |
|----------|---------|
| `WEIGHT_GRAPH` | 0.30 |
| `WEIGHT_BEHAVIORAL` | 0.25 |
| `WEIGHT_DEVICE` | 0.20 |
| `WEIGHT_DEAD_ACCOUNT` | 0.15 |
| `WEIGHT_VELOCITY` | 0.10 |

### Thresholds

| Variable | Default |
|----------|---------|
| `HIGH_RISK_THRESHOLD` | 70 |
| `MEDIUM_RISK_THRESHOLD` | 40 |
| `DORMANT_DAYS_THRESHOLD` | 30 |
| `VELOCITY_WINDOW_SEC` | 60 |
| `BURST_TX_THRESHOLD` | 10 |
| `IMPOSSIBLE_TRAVEL_KMH` | 250 |

### v3 Feature Parameters

| Variable | Default | Description |
|----------|---------|-------------|
| `DEVICE_MULTI_USER_THRESHOLD` | 3 | Users on device before SIM-swap flag |
| `DEVICE_MULTI_USER_PENALTY` | 25.0 | SIM-swap risk points |
| `CIRCADIAN_ANOMALY_PENALTY` | 20.0 | Unusual-hour penalty |
| `CIRCADIAN_NEW_DEVICE_PENALTY` | 35.0 | Amplified: circadian + new device |
| `TX_IDENTICALITY_MIN_COUNT` | 3 | Identical transfers to flag |
| `TX_IDENTICALITY_PENALTY` | 30.0 | Structuring risk points |
| `SLEEP_FLASH_RATIO_THRESHOLD` | 50.0 | Amount/avg ratio for sleep-flash |
| `NEW_DEVICE_HIGH_AMOUNT_THRESHOLD` | 10,000 | Amount threshold for compound signal |
| `IP_ROTATION_MAX_UNIQUE` | 5 | Unique IPs before rotation flag |

---

## 15. Deployment Guide

### Prerequisites

- Docker + Docker Compose
- Python 3.11+
- Node.js 18+
- ~4 GB RAM

### Quick Start

```bash
# ── 1. Infrastructure (pick ONE option) ──────────────────────

# Option A: Docker Compose (recommended)
cd backend && docker compose up -d

# Option B: Standalone Docker containers
docker run -d --name fraud-redis \
  -p 6379:6379 \
  redis:7-alpine \
  redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru

docker run -d --name fraud-neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_PLUGINS='["graph-data-science"]' \
  -e NEO4J_ACCEPT_LICENSE_AGREEMENT=yes \
  -e NEO4J_dbms_memory_heap_initial__size=512m \
  -e NEO4J_dbms_memory_heap_max__size=2G \
  -e NEO4J_dbms_memory_pagecache_size=512m \
  -e NEO4J_server_config_strict__validation_enabled=false \
  neo4j:5.25

# ── 2. Backend ────────────────────────────────────────────────
pip install -r requirements.txt
python scripts/setup_neo4j.py
python scripts/seed_data.py
uvicorn app.main:app --host 0.0.0.0 --port 8000

# ── 3. Frontend ───────────────────────────────────────────────
cd dashboard/frontend
npm install
npm run dev    # → http://localhost:3001

# ── 4. Simulate traffic ──────────────────────────────────────
python scripts/run_simulation.py --tx 100 --tps 15
```

### Infrastructure Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| neo4j | neo4j:5.25 + GDS | 7687 (bolt), 7474 (http) | Graph DB |
| redis | redis:7-alpine | 6379 | Streams + alerts |

### Graceful Degradation

If MMDB file missing: ASN module disabled, `asn_risk = 0`, system remains fully operational.

---

## 16. Project Structure

```
fraud-detection-system/
├── README.md                       # This file (feature overview)
├── APPROACH.md                     # Mathematical foundations & algorithm reference
├── FRONTEND_API_DOCS.md            # Frontend API integration docs
│
├── backend/
│   ├── docker-compose.yml
│   ├── requirements.txt
│   └── app/
│       ├── main.py                 # FastAPI application entry
│       ├── config.py               # All configuration parameters
│       ├── neo4j_manager.py        # Neo4j connection pool
│       ├── api/
│       │   ├── routes.py           # Core API endpoints
│       │   ├── frontend_routes.py  # Dashboard-specific endpoints
│       │   ├── upi_adapter.py      # UPI gateway adapter
│       │   └── websocket.py        # WebSocket alert manager
│       ├── core/
│       │   ├── graph_analyzer.py   # Background GDS + batch aggregation
│       │   ├── risk_engine.py      # Weighted fusion + explainability
│       │   └── worker_pool.py      # Async Redis consumer workers
│       ├── detection/
│       │   ├── anomaly_detection.py # Statistical primitives
│       │   ├── collusive_fraud.py  # 6-pattern batch detection
│       │   └── mule_detection.py   # Per-tx mule classification
│       ├── features/
│       │   ├── behavioral.py       # Behavioural intelligence (v3)
│       │   ├── graph_intelligence.py # GDS-backed graph features
│       │   ├── device_risk.py      # Device fingerprint analysis (v3)
│       │   ├── dead_account.py     # Dormant account detection (v3)
│       │   ├── velocity.py         # Burst & pass-through
│       │   └── asn_intelligence.py # Indian IPv4 ASN pipeline
│       ├── models/
│       │   ├── transaction.py      # Pydantic input models
│       │   ├── risk_score.py       # RiskResponse model
│       │   └── frontend_models.py  # Dashboard response models
│       ├── streaming/
│       │   ├── redis_stream.py     # Redis Streams consumer
│       │   ├── stream_adapter.py   # Stream abstraction layer
│       │   └── transaction_simulator.py # Load testing
│       └── utils/
│           ├── cypher_queries.py   # All Neo4j Cypher queries
│           └── metrics.py          # Precision, recall, F1, latency
│
├── dashboard/frontend/
│   ├── package.json
│   ├── next.config.ts              # Proxy rewrites to backend
│   └── src/
│       ├── app/page.tsx            # Main dashboard (4 tabs)
│       ├── hooks/
│       │   ├── useRealStream.ts    # WebSocket + REST hook
│       │   └── useFilteredTransactions.ts # LRU + debounce + shortcuts
│       ├── components/
│       │   ├── stream/             # TransactionStream, TransactionFilter
│       │   ├── graph/              # GraphExplorer, NodeDrawer
│       │   ├── intelligence/       # BehavioralRadar, GeodesicArcMap, etc.
│       │   ├── gauges/             # RiskGauge, LatencyHeatmap
│       │   ├── charts/             # Recharts analytics
│       │   └── mule/               # MuleManagement
│       └── lib/
│           ├── api.ts              # API client (30s timeout)
│           ├── types.ts            # TypeScript interfaces
│           └── utils.ts            # Risk helpers, formatINR
│
└── scripts/
    ├── setup_neo4j.py              # Index + constraint creation
    ├── seed_data.py                # 20 users, 200 txns, 5% fraud
    ├── run_simulation.py           # Live traffic simulator
    └── start_server.sh             # Server launch script
```

### Architectural Separation

| Directory | Responsibility |
|-----------|---------------|
| `core/` | Orchestration + runtime engine |
| `features/` | Pure scoring logic (stateless) |
| `detection/` | Higher-level fraud patterns |
| `streaming/` | Ingestion layer |
| `models/` | Pydantic schemas |
| `utils/` | Reusable infrastructure helpers |
| `dashboard/` | Real-time Next.js frontend |

---

## 17. Privacy & Compliance (DPDP Act)

| Principle | Implementation |
|-----------|---------------|
| **No balance storage** | No `balance`, `wealth`, or account ledger values stored |
| **No Sensitive Personal Data** | No Aadhaar, PAN, biometrics, health, or financial profile |
| **Behavioural anchors only** | Rolling aggregates (`avg`, `std`, `count`) |
| **Offline ASN resolution** | Local MMDB, no third-party API |
| **Data minimisation** | Store only transaction metadata + risk |

**Regulatory Positioning:**
- **DPDP Act (2023):** System processes transactional metadata and derived statistical features only
- **RBI Alignment:** Fraud scoring occurs post-authentication layer
- **Data Retention:** Supports time-window pruning via Cypher deletes

---

> **17 active fraud signals** · **6 collusive patterns** · **5 concurrent extractors** · **< 200ms scoring** · **500 TPS**
>
> 📐 For detailed mathematical derivations, statistical models, and algorithm foundations → **[APPROACH.md](fraud-detection-system/APPROACH.md)**
>
> *Built for the Indian UPI ecosystem. Version 3 — February 2026.*

