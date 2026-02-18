"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Transaction, SystemHealth, LatencyBucket } from "@/lib/types";

const MAX_TRANSACTIONS = 200;
const TPS_MIN = 100;
const TPS_MAX = 200;
const TICK_MS = 250;
const HEALTH_POLL_MS = 1000;

const USERS = [
  { id: "U0001", name: "Rajesh Kumar", upi: "rajesh.kumar@okaxis", city: "Mumbai", lat: 19.076, lng: 72.8777 },
  { id: "U0002", name: "Priya Sharma", upi: "priya.sharma@okhdfcbank", city: "Delhi", lat: 28.7041, lng: 77.1025 },
  { id: "U0003", name: "Amit Patel", upi: "amit.patel@oksbi", city: "Ahmedabad", lat: 23.0225, lng: 72.5714 },
  { id: "U0004", name: "Sneha Reddy", upi: "sneha.reddy@okicici", city: "Hyderabad", lat: 17.385, lng: 78.4867 },
  { id: "U0005", name: "Vikram Singh", upi: "vikram.singh@paytm", city: "Jaipur", lat: 26.9124, lng: 75.7873 },
  { id: "U0006", name: "Ananya Iyer", upi: "ananya.iyer@okaxis", city: "Chennai", lat: 13.0827, lng: 80.2707 },
  { id: "U0007", name: "Mohammed Farooq", upi: "md.farooq@okhdfcbank", city: "Bangalore", lat: 12.9716, lng: 77.5946 },
  { id: "U0008", name: "Kavitha Nair", upi: "kavitha.nair@oksbi", city: "Kochi", lat: 9.9312, lng: 76.2673 },
  { id: "U0009", name: "Rohit Joshi", upi: "rohit.joshi@okicici", city: "Pune", lat: 18.5204, lng: 73.8567 },
  { id: "U0010", name: "Deepa Menon", upi: "deepa.menon@paytm", city: "Kolkata", lat: 22.5726, lng: 88.3639 },
  { id: "U0011", name: "Suresh Babu", upi: "suresh.babu@okaxis", city: "Coimbatore", lat: 11.0168, lng: 76.9558 },
  { id: "U0012", name: "Meera Deshmukh", upi: "meera.d@okhdfcbank", city: "Nagpur", lat: 21.1458, lng: 79.0882 },
  { id: "U0013", name: "Arjun Malhotra", upi: "arjun.m@oksbi", city: "Chandigarh", lat: 30.7333, lng: 76.7794 },
  { id: "U0014", name: "Lakshmi Sundaram", upi: "lakshmi.s@okicici", city: "Madurai", lat: 9.9252, lng: 78.1198 },
  { id: "U0015", name: "Nikhil Verma", upi: "nikhil.v@paytm", city: "Lucknow", lat: 26.8467, lng: 80.9462 },
  { id: "U0016", name: "Rahul X", upi: "rahulx99@okaxis", city: "Mumbai", lat: 19.076, lng: 72.8777 },
  { id: "U0017", name: "Sanjay Ghost", upi: "sanjay.g77@paytm", city: "Delhi", lat: 28.7041, lng: 77.1025 },
  { id: "U0018", name: "Fake Vendor", upi: "vendor.pay@okaxis", city: "Bangalore", lat: 12.9716, lng: 77.5946 },
  { id: "U0019", name: "Pooja Kapoor", upi: "pooja.k@okhdfcbank", city: "Indore", lat: 22.7196, lng: 75.8577 },
  { id: "U0020", name: "Ravi Shankar", upi: "ravi.shankar@oksbi", city: "Patna", lat: 25.6093, lng: 85.1376 },
];

const IPS = [
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

const INITIAL_HEALTH: SystemHealth = {
  neo4j: { activeConnections: 8, idleConnections: 4, avgQueryMs: 18, nodesCount: 2000, relsCount: 12000 },
  redis: { lagMs: 4, streamDepth: 12, memoryUsedMB: 64, pendingMessages: 0 },
  workers: { active: 6, total: 8, cpuPercent: 42, ramPercent: 58, processedPerSec: 150, wsConnections: 1 },
  tps: 150,
  meanLatencyMs: 85,
  uptime: "2h 14m",
  graphAnalytics: { modularity: 0.62, clusters: 12, bfsLatencyMs: 42 },
  redisWindow: { windowSec: 60, eventsInWindow: 9000 },
};

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function riskToStatus(risk: number): "SUCCESS" | "FAILED" | "BLOCKED" {
  if (risk >= 70) return "BLOCKED";
  if (risk < 5 && Math.random() < 0.1) return "FAILED";
  return "SUCCESS";
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function makeTransaction(): Transaction {
  const sender = pick(USERS);
  let receiver = pick(USERS);
  if (receiver.id === sender.id) receiver = pick(USERS);
  const ip = pick(IPS);
  const risk = Math.round(rand(25, 85) * 100) / 100;
  const amount = Math.round(rand(50, 75000) * 100) / 100;
  const latency = Math.round(rand(30, 180));

  const deviceGeo = { city: sender.city, lat: sender.lat + rand(-0.02, 0.02), lng: sender.lng + rand(-0.02, 0.02) };
  const ipGeo = { city: ip.city, lat: sender.lat + rand(-4, 4), lng: sender.lng + rand(-4, 4) };
  const distanceKm = Math.round(haversineKm(deviceGeo, ipGeo) * 10) / 10;
  const timeDeltaMin = Math.round(rand(5, 180) * 10) / 10;
  const speedKmh = Math.round((distanceKm / (timeDeltaMin / 60)) * 10) / 10;

  const tx: Transaction = {
    id: `mock-${crypto.randomUUID()}`,
    timestamp: new Date(),
    senderName: sender.id,
    senderUPI: sender.upi,
    receiverName: receiver.id,
    receiverUPI: receiver.upi,
    amount,
    status: riskToStatus(risk),
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
      deviceGeo,
      ipGeo,
      distanceKm,
      timeDeltaMin,
      speedKmh,
      isImpossible: speedKmh > 250,
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
  };

  return tx;
}

export function useMockStream() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth>(INITIAL_HEALTH);
  const [latencyBuckets, setLatencyBuckets] = useState<LatencyBucket[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [totalProcessed, setTotalProcessed] = useState(0);
  const [totalBlocked, setTotalBlocked] = useState(0);
  const [blockedVolume, setBlockedVolume] = useState(0);
  const [globalRiskAvg, setGlobalRiskAvg] = useState(45);
  const [connected] = useState(true);

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const tpsRef = useRef(Math.round(rand(TPS_MIN, TPS_MAX)));
  const bucketIndexRef = useRef(0);

  const togglePause = useCallback(() => setIsPaused((p) => !p), []);

  useEffect(() => {
    const tpsTimer = setInterval(() => {
      tpsRef.current = Math.round(rand(TPS_MIN, TPS_MAX));
    }, 1000);

    const tick = setInterval(() => {
      if (isPausedRef.current) return;
      const tps = tpsRef.current;
      const count = Math.max(1, Math.round((tps * TICK_MS) / 1000));
      const newTxs = Array.from({ length: count }, makeTransaction);

      setTransactions((prev) => [...newTxs, ...prev].slice(0, MAX_TRANSACTIONS));
      setTotalProcessed((p) => p + count);

      const blocked = newTxs.filter((t) => t.status === "BLOCKED");
      if (blocked.length) {
        setTotalBlocked((p) => p + blocked.length);
        setBlockedVolume((p) => p + blocked.reduce((s, t) => s + t.amount, 0));
      }

      const avgRisk = newTxs.reduce((s, t) => s + t.riskScore, 0) / newTxs.length;
      setGlobalRiskAvg((prev) => prev * 0.9 + avgRisk * 0.1);

      setLatencyBuckets((prev) => {
        const next = [...prev];
        for (const tx of newTxs) {
          next.push({ index: bucketIndexRef.current++, latencyMs: tx.latencyMs || 50, timestamp: tx.timestamp });
        }
        return next.slice(-100);
      });
    }, TICK_MS);

    const healthTimer = setInterval(() => {
      const tps = tpsRef.current;
      setSystemHealth((prev) => ({
        ...prev,
        tps,
        meanLatencyMs: Math.round(rand(40, 140)),
        workers: {
          ...prev.workers,
          processedPerSec: tps,
          cpuPercent: Math.round(rand(25, 80)),
          ramPercent: Math.round(rand(35, 85)),
        },
        redis: {
          ...prev.redis,
          lagMs: Math.round(rand(1, 12)),
          streamDepth: Math.round(rand(5, 40)),
          memoryUsedMB: Math.round(rand(48, 160)),
        },
        redisWindow: {
          ...prev.redisWindow,
          eventsInWindow: Math.round(tps * prev.redisWindow.windowSec),
        },
      }));
    }, HEALTH_POLL_MS);

    return () => {
      clearInterval(tpsTimer);
      clearInterval(tick);
      clearInterval(healthTimer);
    };
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
