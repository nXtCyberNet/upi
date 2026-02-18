// ══════════════════════════════════════════════════════════════
// API Service Layer — typed fetch functions for all backend endpoints
// ══════════════════════════════════════════════════════════════

import type {
  Transaction,
  SystemHealth,
  GraphNode,
  GraphEdge,
  AggregatorNode,
  ASNEntry,
  DeviceCluster,
  RealtimeSubgraph,
  LatencyBucket,
} from "./types";

// Configurable base URL — uses Next.js rewrites proxy in development
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/backend";
// Mock mode: remove backend dependency
const USE_MOCK = true;

// ── generic fetch helper ─────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 30000); // 30s default timeout

  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
      ...init,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`API ${res.status}: ${res.statusText} — ${url} ${body}`);
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Date rehydration helper ──────────────────────────────────

function rehydrateTx(raw: Record<string, unknown>): Transaction {
  return {
    ...raw,
    timestamp: new Date(raw.timestamp as string),
  } as unknown as Transaction;
}

function rehydrateDate<T extends { timestamp?: string | Date }>(obj: T): T & { timestamp: Date } {
  return { ...obj, timestamp: new Date(obj.timestamp as string) } as T & { timestamp: Date };
}

// ── Mock data generators (frontend-only) ────────────────────

const MOCK_USERS = [
  { id: "U0001", name: "Rajesh Kumar", upi: "rajesh.kumar@okaxis", city: "Mumbai" },
  { id: "U0002", name: "Priya Sharma", upi: "priya.sharma@okhdfcbank", city: "Delhi" },
  { id: "U0003", name: "Amit Patel", upi: "amit.patel@oksbi", city: "Ahmedabad" },
  { id: "U0004", name: "Sneha Reddy", upi: "sneha.reddy@okicici", city: "Hyderabad" },
  { id: "U0005", name: "Vikram Singh", upi: "vikram.singh@paytm", city: "Jaipur" },
  { id: "U0006", name: "Ananya Iyer", upi: "ananya.iyer@okaxis", city: "Chennai" },
  { id: "U0007", name: "Mohammed Farooq", upi: "md.farooq@okhdfcbank", city: "Bangalore" },
  { id: "U0008", name: "Kavitha Nair", upi: "kavitha.nair@oksbi", city: "Kochi" },
  { id: "U0009", name: "Rohit Joshi", upi: "rohit.joshi@okicici", city: "Pune" },
  { id: "U0010", name: "Deepa Menon", upi: "deepa.menon@paytm", city: "Kolkata" },
  { id: "U0011", name: "Suresh Babu", upi: "suresh.babu@okaxis", city: "Coimbatore" },
  { id: "U0012", name: "Meera Deshmukh", upi: "meera.d@okhdfcbank", city: "Nagpur" },
  { id: "U0013", name: "Arjun Malhotra", upi: "arjun.m@oksbi", city: "Chandigarh" },
  { id: "U0014", name: "Lakshmi Sundaram", upi: "lakshmi.s@okicici", city: "Madurai" },
  { id: "U0015", name: "Nikhil Verma", upi: "nikhil.v@paytm", city: "Lucknow" },
  { id: "U0016", name: "Rahul X", upi: "rahulx99@okaxis", city: "Mumbai" },
  { id: "U0017", name: "Sanjay Ghost", upi: "sanjay.g77@paytm", city: "Delhi" },
  { id: "U0018", name: "Fake Vendor", upi: "vendor.pay@okaxis", city: "Bangalore" },
  { id: "U0019", name: "Pooja Kapoor", upi: "pooja.k@okhdfcbank", city: "Indore" },
  { id: "U0020", name: "Ravi Shankar", upi: "ravi.shankar@oksbi", city: "Patna" },
];

const MOCK_IPS = [
  { ip: "49.36.128.42", city: "Mumbai" },
  { ip: "59.89.176.22", city: "Kochi" },
  { ip: "122.161.68.113", city: "Ahmedabad" },
  { ip: "106.210.35.89", city: "Madurai" },
  { ip: "49.37.200.156", city: "Bangalore" },
  { ip: "49.44.32.97", city: "Patna" },
  { ip: "49.205.72.18", city: "Hyderabad" },
  { ip: "103.57.84.39", city: "Jaipur" },
  { ip: "3.6.82.140", city: "AWS Mumbai" },
  { ip: "164.52.192.76", city: "DigitalOcean" },
];

const MOCK_ASNS = [
  { provider: "Jio", asn: "AS55836" },
  { provider: "Airtel", asn: "AS24560" },
  { provider: "BSNL", asn: "AS9829" },
  { provider: "ACT Fibernet", asn: "AS24389" },
  { provider: "Vodafone", asn: "AS24560" },
  { provider: "AWS", asn: "AS16509" },
  { provider: "DigitalOcean", asn: "AS14061" },
];

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function mockTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const sender = pick(MOCK_USERS);
  let receiver = pick(MOCK_USERS);
  if (receiver.id === sender.id) receiver = pick(MOCK_USERS);
  const ip = pick(MOCK_IPS);
  const risk = Math.round(rand(20, 85) * 100) / 100;
  const amount = Math.round(rand(50, 75000) * 100) / 100;
  const latency = Math.round(rand(30, 160));
  const status: Transaction["status"] = risk >= 70 ? "BLOCKED" : risk < 5 ? "FAILED" : "SUCCESS";
  return {
    id: `mock-${crypto.randomUUID()}`,
    timestamp: new Date(),
    senderName: sender.id,
    senderUPI: sender.upi,
    receiverName: receiver.id,
    receiverUPI: receiver.upi,
    amount,
    status,
    riskScore: risk,
    latencyMs: latency,
    senderIP: ip.ip,
    deviceId: `DEV${Math.floor(rand(1, 15)).toString().padStart(4, "0")}`,
    city: sender.city,
    features: {
      graph: Math.round(rand(10, 90)),
      behavioral: Math.round(rand(10, 90)),
      device: Math.round(rand(10, 90)),
      deadAccount: Math.round(rand(10, 90)),
      velocity: Math.round(rand(10, 90)),
    },
    triggeredRules: risk >= 70 ? [{ severity: "CRITICAL", rule: "High Risk Spike", detail: "Composite score exceeded threshold", scoreImpact: 22 }] : [],
    geoEvidence: {
      deviceGeo: { city: sender.city, lat: rand(8, 30), lng: rand(70, 90) },
      ipGeo: { city: ip.city, lat: rand(8, 30), lng: rand(70, 90) },
      distanceKm: Math.round(rand(10, 2000) * 10) / 10,
      timeDeltaMin: Math.round(rand(5, 240) * 10) / 10,
      speedKmh: Math.round(rand(10, 800) * 10) / 10,
      isImpossible: risk >= 70 && Math.random() < 0.3,
    },
    behavioralSignature: {
      amountEntropy: Math.round(rand(40, 95)),
      fanInRatio: Math.round(rand(10, 80)),
      temporalAlignment: Math.round(rand(30, 95)),
      deviceAging: Math.round(rand(20, 90)),
      networkDiversity: Math.round(rand(10, 90)),
      velocityBurst: Math.round(rand(5, 80)),
      circadianBitmask: Math.round(rand(30, 90)),
      ispConsistency: Math.round(rand(30, 95)),
    },
    semanticAlert: risk >= 70 ? "High-risk anomaly detected across device, network, and velocity signals." : "",
    probabilityMatrix: [],
    ...overrides,
  };
}

let mockGraphCache: { nodes: GraphNode[]; edges: GraphEdge[] } | null = null;

function mockGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (mockGraphCache) return mockGraphCache;
  const nodes: GraphNode[] = MOCK_USERS.map((u) => {
    const risk = Math.round(rand(20, 85) * 100) / 100;
    const type: GraphNode["type"] = risk >= 70 ? "mule" : risk >= 55 ? "aggregator" : "user";
    return {
      id: u.id,
      name: u.id,
      upi: u.upi,
      type,
      riskScore: risk,
      fanIn: Math.round(rand(1, 20)),
      fanOut: Math.round(rand(1, 20)),
      betweennessCentrality: Math.round(rand(0, 2) * 1000) / 1000,
      pageRank: Math.round(rand(0.01, 1.5) * 1000000) / 1000000,
      deviceCount: Math.round(rand(1, 10)),
      city: u.city,
      lastActive: new Date(Date.now() - rand(0, 48 * 60 * 60 * 1000)),
      isFlagged: risk >= 40,
      isBlocked: risk >= 70,
      cluster: Math.floor(rand(1, 10)),
      cycleDetected: Math.random() < 0.1,
      localClusterCoeff: Math.round(rand(0.1, 0.9) * 10000) / 10000,
    };
  });

  const edges: GraphEdge[] = [];
  for (const n of nodes) {
    const outCount = Math.floor(rand(2, 6));
    for (let i = 0; i < outCount; i++) {
      const t = pick(nodes);
      if (t.id === n.id) continue;
      edges.push({
        source: n.id,
        target: t.id,
        amount: Math.round(rand(50, 50000) * 100) / 100,
        count: Math.round(rand(1, 5)),
        timestamp: new Date(Date.now() - rand(0, 48 * 60 * 60 * 1000)),
        is3Hop: false,
      });
    }
  }

  mockGraphCache = { nodes, edges };
  return mockGraphCache;
}

function mockSubgraph(nodeId: string): RealtimeSubgraph {
  const { nodes, edges } = mockGraph();
  const center = nodes.find((n) => n.id === nodeId) || pick(nodes);
  const neighbors = nodes.filter((n) => n.id !== center.id).slice(0, 6);
  const subNodes = [center, ...neighbors].map((n, i) => ({
    id: n.id,
    name: n.name,
    upi: n.upi,
    level: i === 0 ? 0 : (i % 3 + 1) as 1 | 2 | 3,
    type: n.type,
    riskScore: n.riskScore,
    city: n.city,
    deviceCount: n.deviceCount,
    fanIn: n.fanIn,
    fanOut: n.fanOut,
  }));
  const subEdges = edges
    .filter((e) => e.source === center.id || e.target === center.id)
    .slice(0, 10)
    .map((e, i) => ({
      source: e.source,
      target: e.target,
      amount: e.amount,
      timestamp: e.timestamp,
      level: ((i % 3) + 1) as 1 | 2 | 3,
      velocity: Math.round(rand(50, 900)),
    }));
  return {
    txId: `mock-${nodeId}`,
    timestamp: new Date(),
    nodes: subNodes,
    edges: subEdges,
    reachabilityScore: Math.round(rand(0.1, 0.9) * 1000) / 1000,
    circularityIndex: Math.round(rand(0.1, 0.9) * 1000) / 1000,
    hopAdjustedVelocity: Math.round(rand(80, 600)),
    cycleDetected: Math.random() < 0.2,
    cycleNodes: subNodes.filter((n) => n.riskScore >= 70).map((n) => n.id),
    networkPathVelocityMin: Math.round(rand(40, 400)),
    betweennessCentrality: Math.round(rand(0, 2) * 1000) / 1000,
    geoIpConvergence: Math.round(rand(0.1, 0.9) * 1000) / 1000,
    identityDensity: Math.round(rand(0.1, 0.9) * 1000) / 1000,
  };
}

function mockSystemHealth(): SystemHealth {
  const tps = Math.round(rand(100, 200));
  return {
    neo4j: { activeConnections: 8, idleConnections: 4, avgQueryMs: Math.round(rand(8, 30)), nodesCount: 2200, relsCount: 14000 },
    redis: { lagMs: Math.round(rand(1, 12)), streamDepth: Math.round(rand(5, 40)), memoryUsedMB: Math.round(rand(48, 160)), pendingMessages: 0 },
    workers: { active: 6, total: 8, cpuPercent: Math.round(rand(25, 80)), ramPercent: Math.round(rand(35, 85)), processedPerSec: tps, wsConnections: 1 },
    tps,
    meanLatencyMs: Math.round(rand(40, 140)),
    uptime: "3h 41m",
    graphAnalytics: { modularity: Math.round(rand(0.4, 0.8) * 100) / 100, clusters: Math.round(rand(6, 18)), bfsLatencyMs: Math.round(rand(20, 80)) },
    redisWindow: { windowSec: 60, eventsInWindow: tps * 60 },
  };
}

function mockRiskDistribution() {
  return [
    { range: "0-20", count: Math.round(rand(20, 50)), color: "#22c55e" },
    { range: "20-40", count: Math.round(rand(60, 120)), color: "#38bdf8" },
    { range: "40-60", count: Math.round(rand(80, 160)), color: "#f59e0b" },
    { range: "60-80", count: Math.round(rand(40, 90)), color: "#ef4444" },
    { range: "80-100", count: Math.round(rand(5, 30)), color: "#dc2626" },
  ];
}

// ═══ System Health ═══════════════════════════════════════════

export async function fetchSystemHealth(): Promise<SystemHealth> {
  if (USE_MOCK) return mockSystemHealth();
  return apiFetch<SystemHealth>("/system/health");
}

// ═══ Graph Network ═══════════════════════════════════════════

export async function fetchGraphNetwork(
  minRisk = 0,
  clusterIds?: number[]
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  if (USE_MOCK) return mockGraph();
  const params = new URLSearchParams({ min_risk: String(minRisk) });
  if (clusterIds?.length) params.set("cluster_ids", clusterIds.join(","));

  const data = await apiFetch<{ nodes: GraphNode[]; edges: GraphEdge[] }>(
    `/graph/network?${params}`
  );

  return {
    nodes: data.nodes.map((n) => ({
      ...n,
      lastActive: new Date(n.lastActive),
    })),
    edges: data.edges.map((e) => ({
      ...e,
      timestamp: new Date(e.timestamp),
    })),
  };
}

// ═══ Subgraph (3-hop) ════════════════════════════════════════

export async function fetchSubgraph(nodeId: string): Promise<RealtimeSubgraph> {
  if (USE_MOCK) return mockSubgraph(nodeId);
  const raw = await apiFetch<RealtimeSubgraph>(`/graph/subgraph/${encodeURIComponent(nodeId)}`);
  return {
    ...raw,
    timestamp: new Date(raw.timestamp),
    nodes: raw.nodes,
    edges: raw.edges.map((e) => ({
      ...e,
      timestamp: new Date(e.timestamp),
    })),
  };
}

// ═══ Node Transactions ═══════════════════════════════════════

export async function fetchNodeTransactions(
  nodeId: string,
  limit = 20
): Promise<Transaction[]> {
  if (USE_MOCK) {
    return Array.from({ length: limit }, () => mockTransaction({ senderName: nodeId, senderUPI: `${nodeId}@upi` }));
  }
  const data = await apiFetch<{ transactions: Record<string, unknown>[] }>(
    `/graph/node/${encodeURIComponent(nodeId)}/transactions?limit=${limit}`
  );
  return data.transactions.map(rehydrateTx);
}

// ═══ Mule: Aggregators ═══════════════════════════════════════

export async function fetchAggregators(limit = 20): Promise<AggregatorNode[]> {
  if (USE_MOCK) {
    const { nodes } = mockGraph();
    return nodes
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, limit)
      .map((n, i) => ({
        id: n.id,
        name: n.name,
        upi: n.upi,
        betweennessCentrality: n.betweennessCentrality,
        pageRank: n.pageRank,
        fanIn: n.fanIn,
        fanOut: n.fanOut,
        totalVolume: Math.round(rand(100000, 900000)),
        riskScore: n.riskScore,
        flaggedAt: new Date(Date.now() - i * 3600 * 1000),
        cluster: n.cluster || 1,
        deviceCount: n.deviceCount,
      }));
  }
  const data = await apiFetch<{ aggregators: AggregatorNode[] }>(
    `/mule/aggregators?limit=${limit}`
  );
  return data.aggregators.map((a) => ({
    ...a,
    flaggedAt: new Date(a.flaggedAt),
  }));
}

// ═══ Mule: ASN Density ═══════════════════════════════════════

export async function fetchASNDensity(): Promise<ASNEntry[]> {
  if (USE_MOCK) {
    return MOCK_ASNS.map((a) => ({
      asn: a.asn,
      provider: a.provider,
      txCount: Math.round(rand(50, 500)),
      riskTxCount: Math.round(rand(10, 120)),
      percentage: Math.round(rand(5, 30) * 10) / 10,
      isRisky: a.provider === "AWS" || a.provider === "DigitalOcean",
    }));
  }
  const data = await apiFetch<{ entries: ASNEntry[] }>("/mule/asn-density");
  return data.entries;
}

// ═══ Mule: ASN Transactions ═════════════════════════════════

export async function fetchASNTransactions(
  provider: string,
  limit = 15
): Promise<Transaction[]> {
  if (USE_MOCK) {
    return Array.from({ length: limit }, () => mockTransaction({ senderIP: `${provider}-ip` }));
  }
  const data = await apiFetch<{ transactions: Record<string, unknown>[] }>(
    `/mule/asn/${encodeURIComponent(provider)}/transactions?limit=${limit}`
  );
  return data.transactions.map(rehydrateTx);
}

// ═══ Mule: Device Clusters ═══════════════════════════════════

export async function fetchDeviceClusters(minAccounts = 2): Promise<DeviceCluster[]> {
  if (USE_MOCK) {
    return Array.from({ length: 5 }, (_, i) => ({
      deviceId: `DEV${(i + 1).toString().padStart(4, "0")}`,
      userCount: Math.round(rand(minAccounts, minAccounts + 4)),
      users: MOCK_USERS.slice(i, i + 3).map((u) => u.id),
      firstSeen: new Date(Date.now() - rand(3, 30) * 86400000),
      lastSeen: new Date(Date.now() - rand(0, 2) * 86400000),
      riskScore: Math.round(rand(20, 90)),
    }));
  }
  const data = await apiFetch<{ clusters: DeviceCluster[] }>(
    `/mule/device-clusters?min_accounts=${minAccounts}`
  );
  return data.clusters.map((c) => ({
    ...c,
    firstSeen: new Date(c.firstSeen),
    lastSeen: new Date(c.lastSeen),
  }));
}

// ═══ Stream: Recent transactions ═════════════════════════════

export async function fetchRecentTransactions(limit = 50): Promise<Transaction[]> {
  if (USE_MOCK) {
    return Array.from({ length: limit }, () => mockTransaction());
  }
  const data = await apiFetch<{ transactions: Record<string, unknown>[] }>(
    `/stream/recent?limit=${limit}`
  );
  return data.transactions.map(rehydrateTx);
}

// ═══ Analytics: TPS Time Series ══════════════════════════════

export async function fetchTPSSeries(
  windowSec = 300,
  bucketSec = 5
): Promise<{ time: string; tps: number; risk: number }[]> {
  if (USE_MOCK) {
    const buckets = Math.floor(windowSec / bucketSec);
    const now = Date.now();
    return Array.from({ length: buckets }, (_, i) => {
      const t = new Date(now - (buckets - i) * bucketSec * 1000);
      return { time: t.toISOString(), tps: Math.round(rand(100, 200)), risk: Math.round(rand(25, 70)) };
    });
  }
  const data = await apiFetch<{ series: { time: string; tps: number; risk: number }[] }>(
    `/analytics/tps-series?window_sec=${windowSec}&bucket_sec=${bucketSec}`
  );
  return data.series;
}

// ═══ Analytics: Risk Distribution ════════════════════════════

export async function fetchRiskDistribution(): Promise<
  { range: string; count: number; color: string }[]
> {
  if (USE_MOCK) return mockRiskDistribution();
  const data = await apiFetch<{
    distribution: { range: string; count: number; color: string }[];
  }>("/analytics/risk-distribution");
  return data.distribution;
}

// ═══ AI Analysis ═════════════════════════════════════════════

export interface AIAnalysisResult {
  summary: string;
  riskVerdict: string;
  issues: { severity: string; title: string; explanation: string }[];
  possibilities: string[];
  recommendation: string;
}

export async function requestAIAnalysis(payload: {
  riskScore: number;
  features: Record<string, number>;
  triggeredRules: { rule: string }[];
  geoEvidence: Record<string, unknown>;
}): Promise<AIAnalysisResult> {
  // Use the local Next.js API route (not the backend proxy)
  const res = await fetch("/api/analysis/ai-summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`AI Analysis ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<AIAnalysisResult>;
}
