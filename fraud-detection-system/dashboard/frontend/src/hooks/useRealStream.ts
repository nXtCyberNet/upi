"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Transaction, SystemHealth, LatencyBucket } from "@/lib/types";
import { fetchSystemHealth, fetchRecentTransactions } from "@/lib/api";

const MAX_TRANSACTIONS = 200;
const HEALTH_POLL_MS = 3000;
const WS_RECONNECT_BASE_MS = 1000;
const WS_RECONNECT_MAX_MS = 30000;

// Stable initial values to avoid hydration mismatch
const INITIAL_HEALTH: SystemHealth = {
  neo4j: { activeConnections: 0, idleConnections: 0, avgQueryMs: 0, nodesCount: 0, relsCount: 0 },
  redis: { lagMs: 0, streamDepth: 0, memoryUsedMB: 0, pendingMessages: 0 },
  workers: { active: 0, total: 8, cpuPercent: 0, ramPercent: 0, processedPerSec: 0, wsConnections: 0 },
  tps: 0,
  meanLatencyMs: 0,
  uptime: "0h 0m",
  graphAnalytics: { modularity: 0, clusters: 0, bfsLatencyMs: 0 },
  redisWindow: { windowSec: 60, eventsInWindow: 0 },
};

export function useRealStream() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth>(INITIAL_HEALTH);
  const [latencyBuckets, setLatencyBuckets] = useState<LatencyBucket[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [totalProcessed, setTotalProcessed] = useState(0);
  const [totalBlocked, setTotalBlocked] = useState(0);
  const [blockedVolume, setBlockedVolume] = useState(0);
  const [globalRiskAvg, setGlobalRiskAvg] = useState(25);
  const [connected, setConnected] = useState(false);

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const bucketIndexRef = useRef(0);

  // ── Load initial transactions from REST ────────────────
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    fetchRecentTransactions(50)
      .then((txs) => {
        setTransactions(txs);
        setTotalProcessed(txs.length);
        const blocked = txs.filter((t) => t.status === "BLOCKED");
        setTotalBlocked(blocked.length);
        setBlockedVolume(blocked.reduce((s, t) => s + t.amount, 0));
        if (txs.length > 0) {
          const avgRisk = txs.reduce((s, t) => s + t.riskScore, 0) / txs.length;
          setGlobalRiskAvg(avgRisk);
        }
        // Seed latency buckets from recent transactions
        const buckets: LatencyBucket[] = txs.slice(0, 100).map((tx, i) => ({
          index: i,
          latencyMs: tx.latencyMs || 50,
          timestamp: tx.timestamp,
        }));
        setLatencyBuckets(buckets);
        bucketIndexRef.current = buckets.length;
      })
      .catch((err) => {
        console.warn("[useRealStream] Failed to load initial transactions:", err);
      });
  }, []);

  // ── WebSocket connection for real-time transactions ────
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      // Determine WS URL — use the backend directly
      const wsBase =
        process.env.NEXT_PUBLIC_WS_URL ||
        (typeof window !== "undefined"
          ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//` +
            `${window.location.hostname}:8000`
          : "ws://localhost:8000");

      const ws = new WebSocket(`${wsBase}/ws/alerts`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WS] Connected");
        setConnected(true);
        reconnectAttemptRef.current = 0;
      };

      ws.onmessage = (event) => {
        if (isPausedRef.current) return;

        try {
          const data = JSON.parse(event.data);

          // The backend now sends the full TransactionOut shape (camelCase)
          const tx: Transaction = {
            ...data,
            timestamp: new Date(data.timestamp),
            features: data.features || {
              graph: 0,
              behavioral: 0,
              device: 0,
              deadAccount: 0,
              velocity: 0,
            },
            triggeredRules: data.triggeredRules || [],
            geoEvidence: data.geoEvidence || {
              deviceGeo: { city: "", lat: 0, lng: 0 },
              ipGeo: { city: "", lat: 0, lng: 0 },
              distanceKm: 0,
              timeDeltaMin: 0,
              speedKmh: 0,
              isImpossible: false,
            },
            behavioralSignature: data.behavioralSignature || {
              amountEntropy: 50,
              fanInRatio: 25,
              temporalAlignment: 80,
              deviceAging: 85,
              networkDiversity: 20,
              velocityBurst: 15,
              circadianBitmask: 80,
              ispConsistency: 85,
            },
            semanticAlert: data.semanticAlert || "",
            probabilityMatrix: data.probabilityMatrix || [],
          };

          setTransactions((prev) => [tx, ...prev].slice(0, MAX_TRANSACTIONS));
          setTotalProcessed((p) => p + 1);

          if (tx.status === "BLOCKED") {
            setTotalBlocked((p) => p + 1);
            setBlockedVolume((p) => p + tx.amount);
          }

          // Rolling risk average
          setGlobalRiskAvg((prev) => {
            const alpha = 0.05;
            return prev * (1 - alpha) + tx.riskScore * alpha;
          });

          // Update latency heatmap
          setLatencyBuckets((prev) => {
            const idx = bucketIndexRef.current++;
            const next = [
              ...prev.slice(-(99)),
              { index: idx, latencyMs: tx.latencyMs || 50, timestamp: new Date() },
            ];
            return next;
          });
        } catch (err) {
          console.warn("[WS] Failed to parse message:", err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

        // Exponential backoff reconnect
        const attempt = reconnectAttemptRef.current++;
        const delay = Math.min(
          WS_RECONNECT_BASE_MS * Math.pow(2, attempt),
          WS_RECONNECT_MAX_MS
        );
        console.log(`[WS] Disconnected, reconnecting in ${delay}ms (attempt ${attempt + 1})`);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = (err) => {
        console.warn("[WS] Error:", err);
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on cleanup
        wsRef.current.close();
      }
    };
  }, []);

  // ── System health polling ──────────────────────────────
  useEffect(() => {
    // Deep-merge backend response with defaults so partial data never crashes UI
    function safeHealth(raw: Partial<SystemHealth>): SystemHealth {
      return {
        ...INITIAL_HEALTH,
        ...raw,
        neo4j: { ...INITIAL_HEALTH.neo4j, ...(raw.neo4j ?? {}) },
        redis: { ...INITIAL_HEALTH.redis, ...(raw.redis ?? {}) },
        workers: { ...INITIAL_HEALTH.workers, ...(raw.workers ?? {}) },
        graphAnalytics: raw.graphAnalytics
          ? { ...INITIAL_HEALTH.graphAnalytics, ...raw.graphAnalytics }
          : INITIAL_HEALTH.graphAnalytics,
        redisWindow: raw.redisWindow
          ? { ...INITIAL_HEALTH.redisWindow, ...raw.redisWindow }
          : INITIAL_HEALTH.redisWindow,
      };
    }

    const interval = setInterval(async () => {
      try {
        const health = await fetchSystemHealth();
        setSystemHealth(safeHealth(health));
      } catch {
        // Keep last known health on failure
      }
    }, HEALTH_POLL_MS);

    // Immediate first fetch
    fetchSystemHealth()
      .then((h) => setSystemHealth(safeHealth(h)))
      .catch(() => {});

    return () => clearInterval(interval);
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused((p) => !p);
  }, []);

  return {
    transactions,
    systemHealth,
    latencyBuckets,
    isPaused,
    togglePause,
    totalProcessed,
    totalBlocked,
    blockedVolume,
    globalRiskAvg,
    connected,
  };
}
