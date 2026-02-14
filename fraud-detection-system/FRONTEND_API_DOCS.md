# 🔌 Frontend → Backend API Integration Reference

> **Purpose**: Complete working documentation of every data structure, API contract, and data flow
> in the dashboard frontend so you can build or modify the backend to serve real data.
>
> **Frontend Stack**: Next.js 16.1.6 · React 19 · TypeScript 5 · D3.js · Recharts · Leaflet.js  
> **Backend Stack**: FastAPI · Neo4j · Redis Streams · WebSocket  
> **Current State**: Frontend uses 100% client-side mock data via `useMockStream()` hook + generators in `mock-data.ts`. The **only** real network call is `POST /api/analysis/ai-summary` (served by a Next.js API route, not the FastAPI backend).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Flow — Current (Mock) vs Target (Real)](#2-data-flow)
3. [Core Data Types — Complete TypeScript Interfaces](#3-core-data-types)
4. [API Endpoints the Frontend Expects](#4-api-endpoints)
5. [Real-Time Data Stream Contract](#5-realtime-stream)
6. [Component → Data Mapping](#6-component-data-mapping)
7. [Mock Data Generators — What They Produce](#7-mock-generators)
8. [Backend Endpoints Already Implemented](#8-existing-backend)
9. [Gap Analysis — What's Missing in the Backend](#9-gap-analysis)
10. [Migration Checklist](#10-migration-checklist)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    NEXT.JS FRONTEND (port 3000)                 │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  useMockStream() │  │ mock-data.ts     │  │ API Routes   │  │
│  │  ─────────────── │  │ ──────────────── │  │ ──────────── │  │
│  │  • generates tx   │  │ • generateTx()   │  │ POST /api/   │  │
│  │    every 150ms    │  │ • generateGraph()│  │ analysis/    │  │
│  │  • sys health/3s  │  │ • generateASN()  │  │ ai-summary   │  │
│  │  • latency heatmap│  │ • etc.           │  │              │  │
│  └────────┬─────────┘  └────────┬─────────┘  └──────┬───────┘  │
│           │                     │                    │          │
│           ▼                     ▼                    ▼          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Dashboard Page (page.tsx) — 4 tabs                        ││
│  │  ┌─────────┐ ┌───────────┐ ┌──────────────┐ ┌───────────┐ ││
│  │  │  Pulse  │ │   Graph   │ │ Intelligence │ │   Mule    │ ││
│  │  │  View   │ │  Explorer │ │   (Quant)    │ │Management │ ││
│  │  └─────────┘ └───────────┘ └──────────────┘ └───────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
│           │                                                     │
│  ┌────────┴────────────────────────────────────────────────────┐│
│  │  Overlays: FullAnalysisView · QuantDrawer · ContextMenu    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
               REPLACE WITH   │  Target: real API calls
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  FASTAPI BACKEND (port 8000)                    │
│                                                                 │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │  Neo4j   │  │   Redis    │  │ Workers  │  │  WebSocket   │ │
│  │  Graph   │  │  Streams   │  │  Pool    │  │  /ws/alerts  │ │
│  └──────────┘  └────────────┘  └──────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow

### Current (Mock — How It Works Now)

| Data Source | Update Frequency | How It's Generated |
|---|---|---|
| Transaction stream | Every **150ms** (~6.7 TPS) | `generateTransaction()` called in `useMockStream()` hook's `setInterval` |
| System health | Every **3 seconds** | `generateSystemHealth()` called in separate `setInterval` |
| Latency heatmap | Per transaction | Appended from each tx's `latencyMs` field |
| Graph nodes + edges | On mount (memoized) | `generateGraphData()` → 60 nodes, computed edges |
| Top aggregators | On mount (memoized) | `generateTopAggregators()` → 10 nodes |
| ASN density data | On mount (memoized) | `generateASNData()` → 12 providers |
| Device clusters | On mount (memoized) | `generateDeviceClusters()` → 15 clusters |
| 3-level subgraph | Per selected tx (memoized) | `generateRealtimeSubgraph(tx)` → nodes, edges, metrics |
| Node transactions | On node click | `generateNodeTransactions(node, count)` → Transaction[] |
| ASN transactions | On ASN click | `generateASNTransactions(provider, count)` → Transaction[] |
| AI analysis | On button click | `POST /api/analysis/ai-summary` → Next.js API route |

### Target (Real — What You Need to Build)

| Data Source | Recommended Method | Backend Endpoint |
|---|---|---|
| Transaction stream | **WebSocket** (`/ws/alerts`) — already exists | Modify to send full `Transaction` shape |
| System health | **GET** `/api/system/health` polling every 3s | New endpoint returning `SystemHealth` |
| Latency heatmap | Derive from transaction latencies | Include in health or stream |
| Graph nodes + edges | **GET** `/api/viz/fraud-network` — exists but needs enrichment | Add missing fields to response |
| Top aggregators | **GET** `/api/mule/aggregators` | New endpoint |
| ASN density data | **GET** `/api/mule/asn-density` | New endpoint |
| Device clusters | **GET** `/api/mule/device-clusters` | New endpoint |
| 3-level subgraph | **GET** `/api/graph/subgraph/{tx_id}` | New endpoint |
| Node transactions | **GET** `/api/graph/node/{node_id}/transactions` | New endpoint |
| ASN transactions | **GET** `/api/mule/asn/{provider}/transactions` | New endpoint |
| AI analysis | **POST** `/api/analysis/ai-summary` | Move from Next.js route to FastAPI |

---

## 3. Core Data Types

> These are the **exact** TypeScript interfaces the frontend uses. Your backend JSON responses
> must match these shapes exactly (field names, nesting, types).

### 3.1 Transaction (Primary Entity)

```typescript
interface Transaction {
  id: string;                    // Unique transaction ID (e.g., "TX-a1b2c3d4")
  timestamp: Date;               // ISO 8601 string → parsed as Date on frontend
  senderName: string;            // Human-readable name
  senderUPI: string;             // e.g., "rohit.sharma@oksbi"
  receiverName: string;
  receiverUPI: string;
  amount: number;                // In INR (e.g., 15000)
  status: "SUCCESS" | "FAILED" | "BLOCKED";
  riskScore: number;             // 0–100
  latencyMs: number;             // Processing latency in ms
  senderIP: string;              // IPv4 address
  deviceId: string;              // Device UUID
  city: string;                  // Indian city name
  features: FeatureScores;       // 5 sub-scores
  triggeredRules: TriggeredRule[];
  geoEvidence: GeoEvidence;      // Geo-IP analysis
  behavioralSignature: BehavioralSignature;  // 8-axis profile
  semanticAlert: string;         // Human-readable alert text (pipe-separated segments)
  probabilityMatrix: ProbabilityMatrixRow[];  // 9-category breakdown
}
```

> **Backend note**: The frontend expects `camelCase` field names. If your backend uses `snake_case`,
> either transform in a Next.js API middleware or configure Pydantic with `alias_generator`.

### 3.2 Feature Scores

```typescript
interface FeatureScores {
  graph: number;        // 0–100, Graph-based risk score
  behavioral: number;   // 0–100, Behavioral anomaly score
  device: number;       // 0–100, Device risk score
  deadAccount: number;  // 0–100, Dormant account reactivation score
  velocity: number;     // 0–100, Transaction velocity score
}
```

**Risk Fusion Formula used in UI:**
```
R = 0.30 × graph + 0.25 × behavioral + 0.20 × device + 0.15 × deadAccount + 0.10 × velocity
```

### 3.3 Triggered Rules

```typescript
interface TriggeredRule {
  severity: "CRITICAL" | "WARNING" | "INFO";
  rule: string;          // e.g., "IMPOSSIBLE_TRAVEL"
  detail: string;        // Human-readable explanation
  scoreImpact: number;   // Points added to risk score
}
```

**Rules the mock generator uses** (for reference):
| Severity | Rule Name | Score Impact |
|---|---|---|
| CRITICAL | IMPOSSIBLE_TRAVEL | 25 |
| CRITICAL | MULE_CHAIN_DETECTED | 30 |
| CRITICAL | DEVICE_FARM_CLUSTER | 20 |
| CRITICAL | RAPID_DRAIN_PATTERN | 25 |
| CRITICAL | GEO_VELOCITY_BREACH | 22 |
| CRITICAL | WASH_TRADE_CYCLE | 28 |
| WARNING | HIGH_FAN_IN_BURST | 12 |
| WARNING | DORMANT_REACTIVATION | 15 |
| WARNING | NIGHTTIME_BULK | 10 |
| WARNING | ASN_HOPPING_ISP | 12 |
| WARNING | CROSS_CITY_VELOCITY | 14 |
| INFO | NEW_DEVICE_LOGIN | 5 |
| INFO | FIRST_TIME_RECEIVER | 3 |
| INFO | MICRO_AMOUNT_PROBE | 4 |

### 3.4 Geo Evidence

```typescript
interface GeoEvidence {
  deviceGeo: {
    city: string;     // e.g., "Mumbai"
    lat: number;      // e.g., 19.076
    lng: number;      // e.g., 72.8777
  };
  ipGeo: {
    city: string;     // e.g., "Delhi"
    lat: number;
    lng: number;
  };
  distanceKm: number;    // Haversine distance between device and IP locations
  timeDeltaMin: number;  // Minutes between last known location and current
  speedKmh: number;      // Implied travel speed = (distanceKm / timeDeltaMin) × 60
  isImpossible: boolean; // true if speedKmh > 900 (impossible travel)
}
```

**Cities with coordinates** (used in mock data — your backend should use real GeoIP data):
```
Mumbai (19.076, 72.8777), Delhi (28.7041, 77.1025), Bangalore (12.9716, 77.5946),
Hyderabad (17.385, 78.4867), Chennai (13.0827, 80.2707), Kolkata (22.5726, 88.3639),
Pune (18.5204, 73.8567), Ahmedabad (23.0225, 72.5714), Jaipur (26.9124, 75.7873),
Lucknow (26.8467, 80.9462), Surat (21.1702, 72.8311), Kochi (9.9312, 76.2673),
Chandigarh (30.7333, 76.7794), Bhopal (23.2599, 77.4126), Guwahati (26.1445, 91.7362)
```

### 3.5 Behavioral Signature (8-Axis Profile)

```typescript
interface BehavioralSignature {
  amountEntropy: number;     // 0–100, Variation in transaction amounts
  fanInRatio: number;        // 0–100, Ratio of incoming to outgoing connections
  temporalAlignment: number; // 0–100, Regularity of transaction timing
  deviceAging: number;       // 0–100, How established the device is
  networkDiversity: number;  // 0–100, Diversity of ASNs/ISPs used
  velocityBurst: number;     // 0–100, Recent transaction speed vs historical
  circadianBitmask: number;  // 0–100, Transaction time distribution (nighttime = suspicious)
  ispConsistency: number;    // 0–100, Consistency of ISP usage
}
```

**Normal baseline values** (displayed as green overlay on radar):
```
Amt Entropy: 72, Fan-In: 25, Temporal: 80, Device Age: 85,
ASN Div: 20, Vel. Burst: 15, Circadian: 80, ISP Cons.: 85
```

### 3.6 Probability Matrix

```typescript
interface ProbabilityMatrixRow {
  category: string;       // e.g., "Graph Intelligence", "Behavioral Anomaly"
  rawValue: string;       // e.g., "72/100", "3.14"
  weight: number;         // e.g., 0.30 (weight in fusion formula)
  weightedScore: number;  // weight × normalized score
  scenario: string;       // e.g., "Fan-out consistent with mule aggregator"
}
```

**9 categories** the frontend builds:
1. Graph Intelligence (weight 0.30)
2. Behavioral Anomaly (weight 0.25)
3. Device Fingerprint (weight 0.20)
4. Dead Account Signal (weight 0.15)
5. Velocity Anomaly (weight 0.10)
6. Net Path Velocity (weight 0.12) — from subgraph
7. Betweenness Centrality (weight 0.08) — from subgraph
8. Geo-IP Convergence (weight 0.06) — from subgraph
9. Identity Density (weight 0.04) — from subgraph

### 3.7 Graph Node

```typescript
interface GraphNode {
  id: string;
  name: string;
  upi: string;
  type: "user" | "mule" | "aggregator";
  riskScore: number;           // 0–100
  fanIn: number;               // Incoming edge count
  fanOut: number;              // Outgoing edge count
  betweennessCentrality: number; // Graph centrality metric
  pageRank: number;            // PageRank score
  deviceCount: number;         // Devices associated with this user
  city: string;
  lastActive: Date;            // ISO 8601
  isFlagged: boolean;
  isBlocked: boolean;
  cluster?: number;            // Community/cluster ID
  cycleDetected: boolean;      // Is this node part of a cycle
  localClusterCoeff: number;   // Local clustering coefficient
}
```

### 3.8 Graph Edge

```typescript
interface GraphEdge {
  source: string;    // Source node ID
  target: string;    // Target node ID
  amount: number;    // Total amount transferred
  count: number;     // Number of transactions
  timestamp: Date;   // Most recent transaction
  is3Hop: boolean;   // Is this a 3-hop relationship
}
```

### 3.9 System Health

```typescript
interface SystemHealth {
  neo4j: {
    activeConnections: number;
    idleConnections: number;
    avgQueryMs: number;       // Average Neo4j query latency
    nodesCount: number;       // Total nodes in graph
    relsCount: number;        // Total relationships in graph
  };
  redis: {
    streamDepth: number;      // Messages in the stream
    lagMs: number;            // Consumer lag
    memoryUsedMB: number;
    pendingMessages: number;
  };
  workers: {
    active: number;           // Currently active workers
    total: number;            // Total worker pool size
    cpuPercent: number;       // CPU usage 0–100
    ramPercent: number;       // RAM usage 0–100
    processedPerSec: number;  // Throughput
  };
  tps: number;                // Transactions per second
  meanLatencyMs: number;      // Mean processing latency
  uptime: string;             // e.g., "3h 24m"
  graphAnalytics: {
    modularity: number;       // Graph modularity score (0–1)
    clusters: number;         // Number of detected clusters
    bfsLatencyMs: number;     // BFS traversal latency
  };
  redisWindow: {
    windowSec: number;        // Sliding window size (default 60)
    eventsInWindow: number;   // Events in current window
  };
}
```

### 3.10 Aggregator Node

```typescript
interface AggregatorNode {
  id: string;
  name: string;
  upi: string;
  betweennessCentrality: number;
  pageRank: number;
  fanIn: number;
  fanOut: number;
  totalVolume: number;         // Total ₹ volume through this node
  riskScore: number;
  flaggedAt: Date;
  cluster: number;
  deviceCount: number;
}
```

### 3.11 ASN Entry

```typescript
interface ASNEntry {
  asn: string;          // ASN number (e.g., "AS9829")
  provider: string;     // ISP name (e.g., "Jio", "Airtel")
  txCount: number;      // Total transactions from this ASN
  riskTxCount: number;  // Transactions with riskScore ≥ 60
  percentage: number;   // riskTxCount / txCount as percentage (0–100)
  isRisky: boolean;     // true if percentage > 40
}
```

### 3.12 Device Cluster

```typescript
interface DeviceCluster {
  deviceId: string;
  userCount: number;       // Users sharing this device
  users: string[];         // List of user IDs
  firstSeen: Date;
  lastSeen: Date;
  riskScore: number;       // 0–100
}
```

### 3.13 Latency Bucket (Heatmap)

```typescript
interface LatencyBucket {
  index: number;       // 0–99 (10×10 grid)
  latencyMs: number;
  timestamp: Date;
}
```

### 3.14 Realtime 3-Level Subgraph

```typescript
interface SubgraphNode {
  id: string;
  name: string;
  upi: string;
  level: 0 | 1 | 2 | 3;               // Hop distance from center
  type: "user" | "mule" | "aggregator";
  riskScore: number;
  city: string;
  deviceCount: number;
  fanIn: number;
  fanOut: number;
}

interface SubgraphEdge {
  source: string;       // Node ID
  target: string;       // Node ID
  amount: number;       // ₹ amount
  timestamp: Date;
  level: 1 | 2 | 3;    // Hop level of this edge
  velocity: number;     // ₹/minute
}

interface RealtimeSubgraph {
  txId: string;                      // Center transaction
  timestamp: Date;
  nodes: SubgraphNode[];             // All nodes in the 3-hop neighborhood
  edges: SubgraphEdge[];             // All edges
  reachabilityScore: number;         // How many nodes are reachable (higher = more connected)
  circularityIndex: number;          // 0–1, proportion of circular paths
  hopAdjustedVelocity: number;       // ₹/min across the subgraph
  cycleDetected: boolean;            // Are there cycles in the subgraph
  cycleNodes: string[];              // Node IDs in the cycle
  networkPathVelocityMin: number;    // Minutes for funds to traverse L1→L3
  betweennessCentrality: number;     // Center node's betweenness
  geoIpConvergence: number;          // 0–1, how much geo locations converge
  identityDensity: number;           // users/device ratio
}
```

### 3.15 AI Analysis Result

```typescript
interface AIAnalysisResult {
  summary: string;           // Plain-English summary for non-technical users
  riskVerdict: string;       // e.g., "HIGH RISK — Immediate Action Required"
  issues: {
    severity: "critical" | "warning" | "info";
    title: string;           // e.g., "Impossible Geographic Movement"
    explanation: string;     // Non-technical explanation
  }[];
  possibilities: string[];   // What might be happening
  recommendation: string;    // What the operator should do
}
```

---

## 4. API Endpoints the Frontend Expects

### 4.1 `POST /api/analysis/ai-summary` — AI Transaction Analysis

> **Currently**: Handled by Next.js API route at `src/app/api/analysis/ai-summary/route.ts`  
> **To migrate**: Move logic to FastAPI backend

**Request:**
```json
{
  "transaction_id": "TX-a1b2c3d4",
  "risk_score": 82,
  "amount": 15000,
  "sender": { "name": "Rohit Sharma", "upi": "rohit.sharma@oksbi" },
  "receiver": { "name": "Priya Patel", "upi": "priya.patel@paytm" },
  "city": "Mumbai",
  "status": "BLOCKED",
  "features": {
    "graph": 85,
    "behavioral": 72,
    "device": 45,
    "deadAccount": 30,
    "velocity": 88
  },
  "triggered_rules": [
    {
      "severity": "CRITICAL",
      "rule": "IMPOSSIBLE_TRAVEL",
      "detail": "Device in Mumbai, IP in Delhi — 1400km in 5min",
      "scoreImpact": 25
    }
  ],
  "geo_evidence": {
    "device_city": "Mumbai",
    "ip_city": "Delhi",
    "distance_km": 1400,
    "speed_kmh": 16800,
    "is_impossible": true
  },
  "behavioral_signature": {
    "amountEntropy": 82,
    "fanInRatio": 65,
    "temporalAlignment": 40,
    "deviceAging": 75,
    "networkDiversity": 58,
    "velocityBurst": 88,
    "circadianBitmask": 35,
    "ispConsistency": 42
  },
  "graph_metrics": {
    "reachability": 4.2,
    "circularity": 0.65,
    "hop_velocity": 8500,
    "cycle_detected": true,
    "betweenness": 0.045,
    "nodes_count": 18,
    "edges_count": 24
  }
}
```

**Response (200):**
```json
{
  "summary": "This transaction between Rohit Sharma and Priya Patel in Mumbai for ₹15,000 has triggered 2 critical alerts...",
  "riskVerdict": "HIGH RISK — Immediate Action Required",
  "issues": [
    {
      "severity": "critical",
      "title": "Physically Impossible Location Change",
      "explanation": "The device is showing in Mumbai while the IP address resolves to Delhi, 1400km away..."
    },
    {
      "severity": "warning",
      "title": "Sudden Activity Surge",
      "explanation": "This account is suddenly making transactions much faster than its historical pattern..."
    }
  ],
  "possibilities": [
    "Large-value transaction could be a legitimate business payment...",
    "Network contains identified mule accounts..."
  ],
  "recommendation": "Immediately block this transaction and freeze both accounts..."
}
```

**Error Response (500):**
```json
{
  "error": "Failed to analyze transaction",
  "detail": "error message"
}
```

---

### 4.2 Endpoints the Frontend Will Need (Currently Mocked)

These are the endpoints you need to create to replace the mock data generators:

#### `GET /api/stream/transactions` (or WebSocket `/ws/transactions`)

Returns a stream of transactions matching the `Transaction` interface.

**Recommended**: Use the existing WebSocket at `/ws/alerts` but expand the payload to include all `Transaction` fields.

**Response per message:**
```json
{
  "id": "TX-a1b2c3d4",
  "timestamp": "2026-02-13T10:30:00Z",
  "senderName": "Rohit Sharma",
  "senderUPI": "rohit.sharma@oksbi",
  "receiverName": "Priya Patel",
  "receiverUPI": "priya.patel@paytm",
  "amount": 15000,
  "status": "BLOCKED",
  "riskScore": 82,
  "latencyMs": 45,
  "senderIP": "103.21.44.67",
  "deviceId": "DEV-uuid-here",
  "city": "Mumbai",
  "features": { "graph": 85, "behavioral": 72, "device": 45, "deadAccount": 30, "velocity": 88 },
  "triggeredRules": [...],
  "geoEvidence": {...},
  "behavioralSignature": {...},
  "semanticAlert": "Geo-Jump: Mumbai→Delhi 1400km in 5min | Velocity: ₹15,000 in burst",
  "probabilityMatrix": [...]
}
```

#### `GET /api/system/health`

Returns `SystemHealth` object. Polled every 3 seconds.

```json
{
  "neo4j": {
    "activeConnections": 12,
    "idleConnections": 3,
    "avgQueryMs": 8.5,
    "nodesCount": 45230,
    "relsCount": 123456
  },
  "redis": {
    "streamDepth": 342,
    "lagMs": 12,
    "memoryUsedMB": 256,
    "pendingMessages": 15
  },
  "workers": {
    "active": 6,
    "total": 8,
    "cpuPercent": 45.2,
    "ramPercent": 62.1,
    "processedPerSec": 142
  },
  "tps": 142.5,
  "meanLatencyMs": 23.4,
  "uptime": "3h 24m",
  "graphAnalytics": {
    "modularity": 0.72,
    "clusters": 14,
    "bfsLatencyMs": 12.3
  },
  "redisWindow": {
    "windowSec": 60,
    "eventsInWindow": 8540
  }
}
```

#### `GET /api/graph/network`

Returns all graph nodes and edges for the Graph Explorer D3 visualization.

**Query params:** `?min_risk=30&cluster_ids=1,2,3` (optional filters)

```json
{
  "nodes": [
    {
      "id": "USR-abc123",
      "name": "Rohit Sharma",
      "upi": "rohit.sharma@oksbi",
      "type": "mule",
      "riskScore": 82,
      "fanIn": 15,
      "fanOut": 3,
      "betweennessCentrality": 0.045,
      "pageRank": 0.0032,
      "deviceCount": 2,
      "city": "Mumbai",
      "lastActive": "2026-02-13T10:30:00Z",
      "isFlagged": true,
      "isBlocked": false,
      "cluster": 3,
      "cycleDetected": true,
      "localClusterCoeff": 0.67
    }
  ],
  "edges": [
    {
      "source": "USR-abc123",
      "target": "USR-def456",
      "amount": 150000,
      "count": 12,
      "timestamp": "2026-02-13T10:30:00Z",
      "is3Hop": false
    }
  ]
}
```

> **Note**: The existing `/viz/fraud-network` endpoint returns a simpler shape. It needs the
> additional fields: `name`, `upi`, `type`, `fanIn`, `fanOut`, `betweennessCentrality`,
> `pageRank`, `deviceCount`, `city`, `lastActive`, `isFlagged`, `isBlocked`,
> `cycleDetected`, `localClusterCoeff`, `cluster` on nodes, and `count`, `timestamp`,
> `is3Hop` on edges.

#### `GET /api/graph/subgraph/{tx_id}`

Returns the 3-level (3-hop) subgraph centered on a transaction.

```json
{
  "txId": "TX-a1b2c3d4",
  "timestamp": "2026-02-13T10:30:00Z",
  "nodes": [
    {
      "id": "USR-abc123",
      "name": "Rohit Sharma",
      "upi": "rohit.sharma@oksbi",
      "level": 0,
      "type": "user",
      "riskScore": 82,
      "city": "Mumbai",
      "deviceCount": 2,
      "fanIn": 15,
      "fanOut": 3
    }
  ],
  "edges": [
    {
      "source": "USR-abc123",
      "target": "USR-def456",
      "amount": 15000,
      "timestamp": "2026-02-13T10:30:00Z",
      "level": 1,
      "velocity": 8500
    }
  ],
  "reachabilityScore": 4.2,
  "circularityIndex": 0.65,
  "hopAdjustedVelocity": 8500,
  "cycleDetected": true,
  "cycleNodes": ["USR-abc123", "USR-def456", "USR-ghi789"],
  "networkPathVelocityMin": 12.5,
  "betweennessCentrality": 0.045,
  "geoIpConvergence": 0.72,
  "identityDensity": 2.3
}
```

#### `GET /api/graph/node/{node_id}/transactions`

Returns transactions associated with a specific node.

**Query params:** `?limit=10`

**Response:** Array of `Transaction` objects (same shape as §3.1)

#### `GET /api/mule/aggregators`

Returns top aggregator nodes sorted by betweenness centrality.

**Query params:** `?limit=10`

**Response:** Array of `AggregatorNode` objects (§3.10)

#### `GET /api/mule/asn-density`

Returns ASN density analysis.

**Response:** Array of `ASNEntry` objects (§3.11)

```json
[
  {
    "asn": "AS55836",
    "provider": "Jio",
    "txCount": 4523,
    "riskTxCount": 312,
    "percentage": 6.9,
    "isRisky": false
  },
  {
    "asn": "AS45609",
    "provider": "Airtel",
    "txCount": 3821,
    "riskTxCount": 1987,
    "percentage": 52.0,
    "isRisky": true
  }
]
```

#### `GET /api/mule/asn/{provider}/transactions`

Returns transactions from a specific ASN provider.

**Query params:** `?limit=15`

**Response:** Array of `Transaction` objects

#### `GET /api/mule/device-clusters`

Returns device-sharing clusters.

**Response:** Array of `DeviceCluster` objects (§3.12)

#### `GET /api/latency/heatmap`

Returns the last 100 latency measurements.

**Response:** Array of `LatencyBucket` objects (§3.13)

---

## 5. Real-Time Data Stream Contract

### Current: `useMockStream()` Hook

Location: `src/hooks/useMockStream.ts`

**What it provides to the dashboard:**

```typescript
{
  transactions: Transaction[];       // Rolling buffer, max 200 items
  systemHealth: SystemHealth;        // Refreshed every 3s
  latencyBuckets: LatencyBucket[];   // Rolling 100-item heatmap
  isPaused: boolean;                 // Pause/resume toggle
  togglePause: () => void;
  totalProcessed: number;            // Running counter
  totalBlocked: number;              // Blocked transaction counter
  blockedVolume: number;             // Total ₹ volume of blocked txs
  globalRiskAvg: number;             // Exponentially weighted moving average (alpha=0.05)
}
```

### To Replace With Real Backend

Create a new `useRealStream()` hook that:

1. **WebSocket** connects to `ws://backend:8000/ws/alerts`
2. On each message, parses the `Transaction` JSON and prepends to the buffer
3. **Polls** `GET /api/system/health` every 3 seconds
4. Maintains the same counters (`totalProcessed`, `totalBlocked`, `blockedVolume`, `globalRiskAvg`)

**WebSocket message shape expected by frontend:**
```json
{
  "type": "transaction",
  "data": { /* full Transaction object */ }
}
```

Or for alerts specifically:
```json
{
  "type": "alert",
  "data": {
    "tx_id": "...",
    "alert_type": "HIGH_RISK",
    "risk_score": 82,
    /* ... rest of Transaction fields ... */
  }
}
```

---

## 6. Component → Data Mapping

### Which component consumes what data:

| Component | Data Required | Currently From |
|---|---|---|
| **TransactionStream** | `Transaction[]` | `useMockStream().transactions` |
| **MetricsPanel** | `tps, meanLatencyMs, totalProcessed, totalBlocked, blockedVolume, globalRiskAvg` | `useMockStream()` |
| **SystemHealthBar** | `SystemHealth` | `useMockStream().systemHealth` |
| **LatencyHeatmap** | `LatencyBucket[]` | `useMockStream().latencyBuckets` |
| **RiskGauge** | `number` (globalRiskAvg) | `useMockStream().globalRiskAvg` |
| **Charts (TPS/Risk/Distribution)** | `Transaction[]` | `useMockStream().transactions` |
| **GraphExplorer** | `GraphNode[], GraphEdge[]` | `generateGraphData()` |
| **GraphExplorer** (live injection) | `RealtimeSubgraph` | `generateRealtimeSubgraph(tx)` per 3rd tx |
| **IntelligencePanel** | `Transaction` | Selected tx state |
| **QuantDrawer** | `Transaction` | Selected tx state |
| **GeodesicArcMap** | `GeoEvidence` | `tx.geoEvidence` |
| **BehavioralRadar** | `BehavioralSignature, riskScore` | `tx.behavioralSignature` |
| **ProbabilityMatrix** | `Transaction` + derives `RealtimeSubgraph` | `tx` + `generateRealtimeSubgraph(tx)` |
| **SemanticAlert** | `string` | `tx.semanticAlert` |
| **MuleManagement** (Aggregators tab) | `AggregatorNode[]` | `generateTopAggregators()` |
| **MuleManagement** (ASN tab) | `ASNEntry[]` | `generateASNData()` |
| **MuleManagement** (ASN drill-down) | `Transaction[]` | `generateASNTransactions(provider, 15)` |
| **MuleManagement** (Devices tab) | `DeviceCluster[]` | `generateDeviceClusters()` |
| **FullAnalysisView** | `Transaction` + `RealtimeSubgraph` | tx prop + `generateRealtimeSubgraph(tx)` |
| **FullAnalysisView** (node click) | `Transaction[]` | `generateNodeTransactions(node, 10)` |
| **FullAnalysisView** (AI button) | `AIAnalysisResult` | `POST /api/analysis/ai-summary` |
| **NodeDrawer** (in GraphExplorer) | `GraphNode` | Selected node state |
| **TransactionContextMenu** | `Transaction` | Right-click target tx |

---

## 7. Mock Data Generators — What They Produce

> These functions in `src/lib/mock-data.ts` need to be replaced with real API calls.

### `generateTransaction(): Transaction`
- Generates a single random transaction with all nested fields
- Called every 150ms by `useMockStream()`
- Risk score distribution: ~60% LOW (10–39), ~25% MEDIUM (40–59), ~10% HIGH (60–79), ~5% CRITICAL (80–95)
- Status: riskScore ≥ 70 → 80% BLOCKED; riskScore ≥ 40 → 20% FAILED; else SUCCESS
- Generates 0–4 triggered rules based on risk score
- Builds `geoEvidence` from random city pairs with Haversine distance
- Builds `behavioralSignature` where high risk → higher anomaly values
- Builds `semanticAlert` by concatenating rule-based text segments with ` | ` separator
- Builds `probabilityMatrix` with 5 base categories

### `generateGraphData(): { nodes: GraphNode[], edges: GraphEdge[] }`
- Creates 60 `GraphNode`s (40 users, 12 mules, 8 aggregators)
- Edges: each node connects to 1–4 random targets
- Betweenness/PageRank/cluster assignments are random

### `generateRealtimeSubgraph(tx: Transaction): RealtimeSubgraph`
- Creates center node (level 0) from the transaction
- Level 1: 3–5 nodes (direct connections)
- Level 2: 2–3 nodes per L1 node
- Level 3: 1–2 nodes per L2 node
- Edges connect adjacent levels
- Computes: reachabilityScore, circularityIndex, hopAdjustedVelocity, cycleDetected, networkPathVelocityMin, betweennessCentrality, geoIpConvergence, identityDensity

### `generateNodeTransactions(node: SubgraphNode, count = 10): Transaction[]`
- Generates `count` transactions associated with a specific graph node
- Tags sender/receiver with the node's name/UPI
- Adjusts risk score by ±15 from the node's base risk
- Semantic alert prefixed with node type (AGGREGATOR NODE / MULE NODE)

### `generateTopAggregators(): AggregatorNode[]`
- Returns 10 aggregator nodes sorted by betweenness centrality (descending)

### `generateASNData(): ASNEntry[]`
- Returns 12 ASN providers with risk percentages
- Providers: Jio, Airtel, Vi, BSNL, ACT Fibernet, Hathway, Excitel, You Broadband, DigitalOcean, AWS Mumbai, Google Cloud, Azure India

### `generateASNTransactions(provider: string | null, count = 15): Transaction[]`
- Generates transactions attributed to a specific ASN provider
- If provider is null, returns empty array

### `generateDeviceClusters(): DeviceCluster[]`
- Returns 15 device clusters sorted by user count (descending)
- Each has 2–8 users sharing a device

### `generateSystemHealth(): SystemHealth`
- Generates realistic system health metrics
- Neo4j: 5–20 connections, 3–25ms query time
- Redis: 50–500 depth, 1–30ms lag
- Workers: 4–8 active of 8 total, 20–85% CPU

### `generateLatencyHeatmap(): LatencyBucket[]`
- Returns 100 latency buckets with values 5–120ms

---

## 8. Backend Endpoints Already Implemented

> These exist in `backend/app/api/routes.py` but need modification to match frontend shapes.

| Endpoint | Method | Current Response Shape | Gap vs Frontend |
|---|---|---|---|
| `/health` | GET | `{ status, neo4j: {...}, workers: { processed, avg_latency_ms, tps } }` | Missing redis, graphAnalytics, redisWindow, full workers shape |
| `/transaction` | POST | `RiskResponse { tx_id, risk_score, risk_level, breakdown, flags, reason }` | Missing all frontend fields (geo, behavioral, semantic, etc.) |
| `/dashboard/stats` | GET | `DashboardStats { total_transactions, flagged, active_clusters, avg_risk, total_amount, avg_processing_time_ms, tps }` | Not directly used by frontend (MetricsPanel derives from stream) |
| `/viz/fraud-network` | GET | `{ nodes: [{id, risk, cluster}], edges: [{source, target, amount, tx_count}] }` | Missing 12+ fields on nodes, 3 fields on edges |
| `/viz/device-sharing` | GET | `{ clusters: [...] }` | Shape not matching `DeviceCluster` interface |
| `/detection/collusive` | GET | Collusive detector summary | Not consumed by frontend currently |
| `/analytics/status` | GET | Graph analyzer stats | Not consumed by frontend currently |
| `/db/counts` | GET | `{ nodes: [...], relationships: [...] }` | Not consumed by frontend currently |
| **WebSocket** `/ws/alerts` | WS | `AlertInfo { alert_id, tx_id, alert_type, risk_score, ... }` | Missing all Transaction fields the frontend needs |

---

## 9. Gap Analysis — What's Missing in the Backend

### 9.1 Missing Endpoints (Must Create)

| Priority | Endpoint | Purpose |
|---|---|---|
| 🔴 HIGH | `GET /api/system/health` | Full `SystemHealth` shape — polled every 3s |
| 🔴 HIGH | `GET /api/graph/subgraph/{tx_id}` | 3-hop subgraph with metrics (for FullAnalysisView, ProbabilityMatrix) |
| 🔴 HIGH | `POST /api/analysis/ai-summary` | Move from Next.js to backend (currently works as Next.js route) |
| 🟡 MEDIUM | `GET /api/mule/aggregators` | Top aggregators by centrality |
| 🟡 MEDIUM | `GET /api/mule/asn-density` | ASN risk distribution |
| 🟡 MEDIUM | `GET /api/mule/asn/{provider}/transactions` | Transactions by ASN |
| 🟡 MEDIUM | `GET /api/mule/device-clusters` | Device farm detection |
| 🟡 MEDIUM | `GET /api/graph/node/{node_id}/transactions` | Node's transaction history |
| 🟢 LOW | `GET /api/latency/heatmap` | Latency measurements |

### 9.2 Existing Endpoints That Need Enrichment

| Endpoint | What To Add |
|---|---|
| `/health` → `/api/system/health` | Add `redis`, `graphAnalytics`, `redisWindow` sections; expand `workers` |
| `/viz/fraud-network` → `/api/graph/network` | Enrich nodes with `name, upi, type, fanIn, fanOut, betweennessCentrality, pageRank, deviceCount, city, lastActive, isFlagged, isBlocked, cycleDetected, localClusterCoeff, cluster`; enrich edges with `count, timestamp, is3Hop` |
| `/transaction` scoring response | Return full `Transaction` shape instead of just `RiskResponse` (or broadcast full shape via WebSocket) |
| WebSocket `/ws/alerts` | Broadcast full `Transaction` object instead of just `AlertInfo` |

### 9.3 Data Pipeline Requirements

To generate the data the frontend expects, your backend needs:

| Feature | Required Backend Capability |
|---|---|
| `geoEvidence` | GeoIP lookup (MaxMind / IP2Location) for device IP + stored device GPS |
| `behavioralSignature` | 8-axis behavioral profiling engine (can derive from Neo4j user properties) |
| `semanticAlert` | Rule engine that generates human-readable text from triggered rules |
| `probabilityMatrix` | Scoring engine that produces per-category breakdown |
| `RealtimeSubgraph` | Neo4j Cypher: 3-hop BFS from transaction nodes, compute graph metrics |
| `AggregatorNode` | Neo4j Cypher: top-K nodes by betweenness centrality |
| `ASNEntry` | Aggregation query on IP → ASN mapping + risk counts |
| `DeviceCluster` | Neo4j Cypher: Device nodes with `USES_DEVICE` relationship counts |

### 9.4 Field Name Convention

The frontend uses **camelCase** everywhere. The backend uses **snake_case** Pydantic models.

**Options:**
1. **Pydantic `model_config`**: `alias_generator = to_camel` with `populate_by_name = True`
2. **Next.js API middleware**: Create `/app/api/proxy/[...path]/route.ts` that fetches from FastAPI and transforms keys
3. **Manual aliases**: Add `Field(alias="camelCase")` to each Pydantic field

**Recommended**: Option 1 — add to all response models:
```python
from pydantic import ConfigDict
from pydantic.alias_generators import to_camel

class TransactionResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    # ... fields ...
```

---

## 10. Migration Checklist

### Phase 1: Core Stream (Replace `useMockStream`)

- [ ] Create `GET /api/system/health` returning full `SystemHealth`
- [ ] Expand WebSocket `/ws/alerts` to broadcast full `Transaction` shape
- [ ] Create `useRealStream()` hook on frontend that:
  - Connects to WebSocket
  - Polls `/api/system/health` every 3s
  - Maintains transaction buffer (max 200)
  - Tracks `totalProcessed`, `totalBlocked`, `blockedVolume`, `globalRiskAvg`
- [ ] Add flag in `page.tsx` to toggle between `useMockStream()` and `useRealStream()`

### Phase 2: Graph Explorer (Replace `generateGraphData`)

- [ ] Enrich `/viz/fraud-network` response to match `GraphNode` + `GraphEdge` interfaces
- [ ] Create `GET /api/graph/subgraph/{tx_id}` for 3-hop neighborhood
- [ ] Wire GraphExplorer to fetch from API instead of mock

### Phase 3: Mule Management (Replace generators)

- [ ] Create `GET /api/mule/aggregators` → `AggregatorNode[]`
- [ ] Create `GET /api/mule/asn-density` → `ASNEntry[]`
- [ ] Create `GET /api/mule/asn/{provider}/transactions` → `Transaction[]`
- [ ] Create `GET /api/mule/device-clusters` → `DeviceCluster[]`
- [ ] Wire MuleManagement to fetch from API

### Phase 4: Intelligence Layer

- [ ] Create `GET /api/graph/node/{node_id}/transactions` → `Transaction[]`
- [ ] Move `POST /api/analysis/ai-summary` to FastAPI backend
- [ ] Ensure backend `TransactionInput` processing pipeline generates all required fields:
  - `geoEvidence` (from GeoIP + stored GPS)
  - `behavioralSignature` (from user profile analysis)
  - `semanticAlert` (from rule engine text generation)
  - `probabilityMatrix` (from scoring breakdown)

### Phase 5: Validation

- [ ] All camelCase field names match frontend interfaces
- [ ] Date fields return ISO 8601 strings
- [ ] Number fields have correct ranges (0–100 for scores, etc.)
- [ ] WebSocket reconnection handling in frontend hook
- [ ] Error states handled (loading spinners, retry logic)
- [ ] Frontend build passes with 0 errors after switching to real API

---

## Appendix A: Utility Functions Reference

These frontend utilities affect how data is displayed. Your backend values should produce
meaningful output through these formatters:

```typescript
formatINR(15000)       → "₹15,000"
formatINR(1500000)     → "₹15,00,000"
formatNumber(1500000)  → "1.5M"
formatNumber(15000)    → "15.0K"
getRiskColor(82)       → "#ef4444" (red)
getRiskColor(65)       → "#f59e0b" (amber)
getRiskColor(45)       → "#38bdf8" (blue)
getRiskColor(20)       → "#10b981" (green)
getRiskLabel(82)       → "CRITICAL"
getRiskLabel(65)       → "HIGH"
getRiskLabel(45)       → "MEDIUM"
getRiskLabel(20)       → "LOW"
timeAgo(2min ago)      → "2m ago"
```

## Appendix B: Risk Score Thresholds

| Range | Label | Color | Badge Class |
|---|---|---|---|
| 80–100 | CRITICAL | `#ef4444` | `risk-badge-critical` |
| 60–79 | HIGH | `#f59e0b` | `risk-badge-high` |
| 40–59 | MEDIUM | `#38bdf8` | `risk-badge-medium` |
| 0–39 | LOW | `#10b981` | `risk-badge-low` |

## Appendix C: Semantic Alert Format

The `semanticAlert` field is a pipe-separated string of alert segments. Each segment is colorized
in the frontend based on keywords:

| Keyword Trigger | Color Applied |
|---|---|
| Geo-Jump, Travel | Red (#ef4444) |
| Cycle, Loop, Circular | Violet (#a78bfa) |
| Device, Farm | Cyan (#22d3ee) |
| Phishing, Drain | Amber (#f59e0b) |
| Velocity, Burst | Sky (#38bdf8) |
| All others | Slate (#94a3b8) |

**Example:**
```
"Geo-Jump: Mumbai→Delhi 1400km in 5min | Velocity: 3 txns in 2min burst | Device: new device first seen today"
```

## Appendix D: Neo4j Cypher Queries You'll Need

### 3-Hop Subgraph from Transaction
```cypher
MATCH (tx:Transaction {tx_id: $tx_id})
MATCH (sender:User)-[:SENT]->(tx)-[:RECEIVED_BY]->(receiver:User)
// Level 1
OPTIONAL MATCH (sender)-[:SENT]->(:Transaction)-[:RECEIVED_BY]->(l1:User)
// Level 2
OPTIONAL MATCH (l1)-[:SENT]->(:Transaction)-[:RECEIVED_BY]->(l2:User)
// Level 3
OPTIONAL MATCH (l2)-[:SENT]->(:Transaction)-[:RECEIVED_BY]->(l3:User)
RETURN sender, receiver, collect(DISTINCT l1) as level1,
       collect(DISTINCT l2) as level2, collect(DISTINCT l3) as level3
```

### Top Aggregators by Betweenness
```cypher
MATCH (u:User)
WHERE u.risk_score > 60
RETURN u.user_id as id, u.risk_score as riskScore,
       u.betweenness as betweennessCentrality,
       u.page_rank as pageRank,
       size((u)<-[:RECEIVED_BY]-()) as fanIn,
       size((u)-[:SENT]->()) as fanOut
ORDER BY u.betweenness DESC LIMIT 10
```

### ASN Density
```cypher
MATCH (ip:IP)<-[:USED_IP]-(u:User)-[:SENT]->(tx:Transaction)
WHERE ip.asn IS NOT NULL
WITH ip.asn_org as provider, ip.asn as asn,
     count(tx) as txCount,
     sum(CASE WHEN tx.risk_score >= 60 THEN 1 ELSE 0 END) as riskTxCount
RETURN asn, provider, txCount, riskTxCount,
       round(100.0 * riskTxCount / txCount, 1) as percentage,
       (100.0 * riskTxCount / txCount) > 40 as isRisky
ORDER BY txCount DESC
```

### Device Clusters
```cypher
MATCH (d:Device)<-[:USES_DEVICE]-(u:User)
WITH d, collect(u.user_id) as users, count(u) as userCount
WHERE userCount >= 2
RETURN d.device_id as deviceId, userCount, users,
       d.first_seen as firstSeen, d.last_seen as lastSeen,
       d.device_score as riskScore
ORDER BY userCount DESC LIMIT 15
```
