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

// ═══ System Health ═══════════════════════════════════════════

export async function fetchSystemHealth(): Promise<SystemHealth> {
  return apiFetch<SystemHealth>("/system/health");
}

// ═══ Graph Network ═══════════════════════════════════════════

export async function fetchGraphNetwork(
  minRisk = 0,
  clusterIds?: number[]
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
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
  const data = await apiFetch<{ transactions: Record<string, unknown>[] }>(
    `/graph/node/${encodeURIComponent(nodeId)}/transactions?limit=${limit}`
  );
  return data.transactions.map(rehydrateTx);
}

// ═══ Mule: Aggregators ═══════════════════════════════════════

export async function fetchAggregators(limit = 20): Promise<AggregatorNode[]> {
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
  const data = await apiFetch<{ entries: ASNEntry[] }>("/mule/asn-density");
  return data.entries;
}

// ═══ Mule: ASN Transactions ═════════════════════════════════

export async function fetchASNTransactions(
  provider: string,
  limit = 15
): Promise<Transaction[]> {
  const data = await apiFetch<{ transactions: Record<string, unknown>[] }>(
    `/mule/asn/${encodeURIComponent(provider)}/transactions?limit=${limit}`
  );
  return data.transactions.map(rehydrateTx);
}

// ═══ Mule: Device Clusters ═══════════════════════════════════

export async function fetchDeviceClusters(minAccounts = 2): Promise<DeviceCluster[]> {
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
  const data = await apiFetch<{ series: { time: string; tps: number; risk: number }[] }>(
    `/analytics/tps-series?window_sec=${windowSec}&bucket_sec=${bucketSec}`
  );
  return data.series;
}

// ═══ Analytics: Risk Distribution ════════════════════════════

export async function fetchRiskDistribution(): Promise<
  { range: string; count: number; color: string }[]
> {
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
