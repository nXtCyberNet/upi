# Real-Time Mule & Collusive Fraud Intelligence Engine (UPI)

A real-time fraud detection system that identifies mule accounts, collusive fraud networks, dormant account activation, device-sharing fraud, and rapid pass-through laundering in UPI transactions.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              Frontend (React + Tailwind)              │
│    Cytoscape.js graphs  │  Recharts analytics        │
└────────────────────┬─────────────────────────────────┘
                     │ WebSocket + REST
┌────────────────────▼─────────────────────────────────┐
│              Backend (FastAPI – async)                │
│  ┌────────────┐ ┌───────────┐ ┌───────────────────┐ │
│  │ Risk Engine│ │ Workers×4 │ │ Graph Analyzer    │ │
│  │ (fusion)   │ │ (Redis)   │ │ (batch GDS 5s)   │ │
│  └────────────┘ └───────────┘ └───────────────────┘ │
└───────┬──────────────┬───────────────────────────────┘
        │              │
   ┌────▼────┐   ┌─────▼─────┐
   │  Neo4j  │   │   Redis   │
   │ (graph) │   │ (streams) │
   └─────────┘   └───────────┘
```

## Quick Start

### 1. Start Infrastructure

```bash
cd backend
docker-compose up -d
```

### 2. Setup Neo4j Schema

```bash
python scripts/setup_neo4j.py
```

### 3. Seed Data

```bash
python scripts/seed_data.py          # with baseline history
python scripts/seed_data.py --clear  # fresh start
```

### 4. Start Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 5. Run Simulation

```bash
python scripts/run_simulation.py --tx 10000 --tps 500
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check + metrics |
| `POST` | `/api/transaction` | Score a single transaction |
| `GET` | `/api/dashboard/stats` | Dashboard statistics |
| `GET` | `/api/viz/fraud-network` | Fraud network graph data |
| `GET` | `/api/viz/device-sharing` | Device sharing clusters |
| `GET` | `/api/detection/collusive` | Collusive detection results |
| `GET` | `/api/analytics/status` | Last GDS analytics run |
| `GET` | `/api/db/counts` | Neo4j node/relationship counts |
| `WS` | `/ws/alerts` | Real-time fraud alerts |

## Neo4j Graph Schema

**Nodes:** `:User`, `:Device`, `:IP`, `:Transaction`, `:Cluster`

**Relationships:**
- `(:User)-[:SENT]->(:Transaction)-[:RECEIVED_BY]->(:User)`
- `(:User)-[:USES_DEVICE]->(:Device)`
- `(:User)-[:ACCESSED_FROM]->(:IP)`
- `(:User)-[:TRANSFERRED_TO]->(:User)` — shortcut for graph analytics
- `(:User)-[:MEMBER_OF]->(:Cluster)`

## Risk Fusion Formula

```
R = 0.30 × S_graph + 0.25 × S_behavioral + 0.20 × S_device
  + 0.15 × S_dead_account + 0.10 × S_velocity
```

## Fraud Detection Capabilities

- ✅ Mule account identification
- ✅ Dormant account activation alerts
- ✅ Circular money flow detection (A→B→C→A)
- ✅ Rapid pass-through chain detection
- ✅ Star hub / fan-in / fan-out patterns
- ✅ Device sharing fraud clusters
- ✅ Behavioural drift & impossible travel
- ✅ Community-based fraud islands (Louvain)
- ✅ Money router detection (betweenness centrality)

## Evaluation Metrics

Run against labelled data to produce: **Precision, Recall, F1-Score, False Positive Rate, Detection Latency, Throughput (TPS)**.
