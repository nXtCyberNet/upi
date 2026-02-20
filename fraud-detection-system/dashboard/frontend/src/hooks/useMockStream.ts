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

// City coordinate lookup — used to resolve IP locations and ensure geo consistency
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  "Mumbai": { lat: 19.076, lng: 72.8777 },
  "Delhi": { lat: 28.7041, lng: 77.1025 },
  "Ahmedabad": { lat: 23.0225, lng: 72.5714 },
  "Hyderabad": { lat: 17.385, lng: 78.4867 },
  "Jaipur": { lat: 26.9124, lng: 75.7873 },
  "Chennai": { lat: 13.0827, lng: 80.2707 },
  "Bangalore": { lat: 12.9716, lng: 77.5946 },
  "Kochi": { lat: 9.9312, lng: 76.2673 },
  "Pune": { lat: 18.5204, lng: 73.8567 },
  "Kolkata": { lat: 22.5726, lng: 88.3639 },
  "Coimbatore": { lat: 11.0168, lng: 76.9558 },
  "Nagpur": { lat: 21.1458, lng: 79.0882 },
  "Chandigarh": { lat: 30.7333, lng: 76.7794 },
  "Madurai": { lat: 9.9252, lng: 78.1198 },
  "Lucknow": { lat: 26.8467, lng: 80.9462 },
  "Indore": { lat: 22.7196, lng: 75.8577 },
  "Patna": { lat: 25.6093, lng: 85.1376 },
  // Cloud/VPN exit nodes — deliberately far from typical user cities
  "AWS ap-south-1": { lat: 19.076, lng: 72.8777 },     // AWS Mumbai region
  "AWS us-east-1": { lat: 39.0438, lng: -77.4874 },     // Virginia
  "DigitalOcean SGP": { lat: 1.3521, lng: 103.8198 },   // Singapore
  "DigitalOcean AMS": { lat: 52.3676, lng: 4.9041 },    // Amsterdam
  "Hetzner HEL": { lat: 60.1695, lng: 24.9354 },        // Helsinki
};

const IPS = [
  // ── Residential ISPs (matched to real Indian cities) ──
  { ip: "49.36.128.42", city: "Mumbai", provider: "Jio", residential: true },
  { ip: "49.36.244.18", city: "Delhi", provider: "Jio", residential: true },
  { ip: "59.89.176.22", city: "Kochi", provider: "BSNL", residential: true },
  { ip: "122.161.68.113", city: "Ahmedabad", provider: "Airtel", residential: true },
  { ip: "106.210.35.89", city: "Madurai", provider: "Airtel", residential: true },
  { ip: "49.37.200.156", city: "Bangalore", provider: "Jio", residential: true },
  { ip: "49.44.32.97", city: "Patna", provider: "Jio", residential: true },
  { ip: "49.205.72.18", city: "Hyderabad", provider: "ACT Fibernet", residential: true },
  { ip: "103.57.84.39", city: "Jaipur", provider: "Vodafone", residential: true },
  { ip: "117.213.86.14", city: "Pune", provider: "BSNL", residential: true },
  { ip: "182.75.116.22", city: "Kolkata", provider: "Airtel", residential: true },
  { ip: "59.96.32.18", city: "Chennai", provider: "Airtel", residential: true },
  { ip: "103.26.192.44", city: "Chandigarh", provider: "Excitel", residential: true },
  { ip: "122.176.14.92", city: "Lucknow", provider: "Airtel", residential: true },
  // ── Cloud / Data-centre IPs (non-residential, fraud signal) ──
  { ip: "3.6.82.140", city: "AWS ap-south-1", provider: "AWS", residential: false },
  { ip: "3.236.112.40", city: "AWS us-east-1", provider: "AWS", residential: false },
  { ip: "164.52.192.76", city: "DigitalOcean SGP", provider: "DigitalOcean", residential: false },
  { ip: "164.90.200.11", city: "DigitalOcean AMS", provider: "DigitalOcean", residential: false },
  { ip: "95.216.44.88", city: "Hetzner HEL", provider: "Hetzner", residential: false },
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
  // Only block truly extreme-risk txns, and only ~25% of those — yields ~0.5-1% BLOCKED per 1000 txns
  if (risk >= 80 && Math.random() < 0.25) return "BLOCKED";
  if (risk < 5 && Math.random() < 0.05) return "FAILED";
  return "SUCCESS";
}

// Realistic risk distribution: 85% low (5-50), 12% moderate (50-72), 3% high (72-92)
function sampleRisk(): number {
  const roll = Math.random();
  if (roll < 0.85) return Math.round(rand(5, 50) * 100) / 100;
  if (roll < 0.97) return Math.round(rand(50, 72) * 100) / 100;
  return Math.round(rand(72, 92) * 100) / 100;
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

// ── Correlated feature scores tied to risk level ─────────────
function makeCorrelatedFeatures(risk: number) {
  // High-risk → at least some features are high; low-risk → all low
  const base = risk > 75 ? 55 : risk > 55 ? 35 : risk > 35 ? 20 : 10;
  const ceiling = risk > 75 ? 98 : risk > 55 ? 80 : risk > 35 ? 65 : 55;
  const spike = () => Math.round(rand(base, ceiling));
  return {
    graph: spike(),
    behavioral: spike(),
    device: spike(),
    deadAccount: spike(),
    velocity: spike(),
  };
}

// ── 5-category probability matrix ────────────────────────────
function makeProbabilityMatrix(
  risk: number,
  features: ReturnType<typeof makeCorrelatedFeatures>,
  geo: { distanceKm: number; speedKmh: number; isImpossible: boolean; deviceGeo: { city: string }; ipGeo: { city: string } },
) {
  const integrityRaw = Math.min(100, features.graph * 0.5 + risk * 0.5);
  const geoRaw = geo.isImpossible ? Math.round(rand(85, 98)) : Math.min(100,
    geo.speedKmh > 180 ? Math.round(rand(55, 80)) : Math.round(rand(5, 40)));
  const behavioralRaw = features.behavioral;
  const phishingRaw = Math.min(100, features.device * 0.6 + features.deadAccount * 0.4);
  const temporalRaw = features.velocity;

  return [
    {
      category: "Integrity",
      rawValue: `${integrityRaw.toFixed(0)}/100 — graph + score`,
      weight: 0.30,
      weightedScore: Math.round(integrityRaw * 0.30 * 10) / 10,
      scenario: integrityRaw > 70
        ? "Significant deviation from account baseline"
        : integrityRaw > 40
          ? "Mild deviation — within watchlist threshold"
          : "Consistent with historical account behaviour",
    },
    {
      category: "Geo-Spatial",
      rawValue: geo.isImpossible
        ? `${geo.speedKmh.toFixed(0)} km/h — IMPOSSIBLE`
        : `${geo.distanceKm.toFixed(0)} km offset`,
      weight: 0.20,
      weightedScore: Math.round(geoRaw * 0.20 * 10) / 10,
      scenario: geo.isImpossible
        ? `VPN/proxy suspected: ${geo.deviceGeo.city} → ${geo.ipGeo.city}`
        : geoRaw > 50
          ? `Suspicious IP discrepancy (${geo.distanceKm.toFixed(0)} km)`
          : "IP matches expected geographic footprint",
    },
    {
      category: "Behavioral",
      rawValue: `${behavioralRaw}/100 anomaly index`,
      weight: 0.25,
      weightedScore: Math.round(behavioralRaw * 0.25 * 10) / 10,
      scenario: behavioralRaw > 70
        ? "Multiple simultaneous behavioral anomalies"
        : behavioralRaw > 45
          ? "Elevated velocity / amount entropy"
          : "Normal send/receive behavioural pattern",
    },
    {
      category: "Phishing",
      rawValue: `${phishingRaw.toFixed(0)}/100 — device×account`,
      weight: 0.15,
      weightedScore: Math.round(phishingRaw * 0.15 * 10) / 10,
      scenario: phishingRaw > 70
        ? "High-risk device or recently dormant account"
        : phishingRaw > 40
          ? "Device seen across multiple accounts"
          : "Single-user device, normal account history",
    },
    {
      category: "Temporal",
      rawValue: `Burst: ${features.velocity}/100`,
      weight: 0.10,
      weightedScore: Math.round(features.velocity * 0.10 * 10) / 10,
      scenario: features.velocity > 70
        ? "Burst pattern: rapid back-to-back transactions"
        : features.velocity > 40
          ? "Slightly elevated send frequency"
          : "Normal inter-transaction timing",
    },
  ];
}

// ── Bank of contextual triggered rules ───────────────────────
const RULE_BANK = {
  impossibleTravel: (speedKmh: number, from: string, to: string) => ({
    severity: "CRITICAL" as const,
    rule: "Impossible Travel Detected",
    detail: `Device in ${from} but IP from ${to} implies ${speedKmh.toFixed(0)} km/h — physically impossible. Probable VPN or compromised account.`,
    scoreImpact: 25,
  }),
  highGraphRisk: () => ({
    severity: "CRITICAL" as const,
    rule: "Fraud Network Connection",
    detail: "Sender node is 2 hops from 3+ known mule accounts. Louvain community assignment matches flagged cluster.",
    scoreImpact: 20,
  }),
  relayMulePattern: (min: number) => ({
    severity: "CRITICAL" as const,
    rule: "Relay Mule Pattern",
    detail: `Funds traversed L1→L3 in ${min.toFixed(0)} min — automated layering pattern. Money moves faster than manual transfers allow.`,
    scoreImpact: 22,
  }),
  simSwap: () => ({
    severity: "CRITICAL" as const,
    rule: "SIM-Swap Multi-User Signal",
    detail: "Device hash shared by >3 distinct UPI accounts in the past 24h — strong SIM-swap indicator.",
    scoreImpact: 18,
  }),
  sleepAndFlash: () => ({
    severity: "CRITICAL" as const,
    rule: "Sleep-and-Flash Mule",
    detail: "Account dormant >30 days activated with transaction ≥50× historical average. Classic dormant account takeover.",
    scoreImpact: 20,
  }),
  circularFlow: () => ({
    severity: "CRITICAL" as const,
    rule: "Circular Money Flow",
    detail: "Funds return to origin-adjacent account within 4 hops — wash trading / layering cycle detected.",
    scoreImpact: 24,
  }),
  velocityBurst: (burst: number) => ({
    severity: "WARNING" as const,
    rule: "Velocity Burst Anomaly",
    detail: `Send-rate ${burst}/100 — ${burst > 80 ? "5×" : "3×"} the 30-day rolling average. Rapid drain pattern.`,
    scoreImpact: 12,
  }),
  highFanIn: (ratio: number) => ({
    severity: "WARNING" as const,
    rule: "Fan-In Aggregation",
    detail: `Receiver aggregating from ${ratio > 70 ? "≥12" : "6-10"} unique senders simultaneously — mule aggregator behaviour.`,
    scoreImpact: 10,
  }),
  newDeviceHighAmount: (amount: number) => ({
    severity: "WARNING" as const,
    rule: "New Device + High Amount",
    detail: `First-time device hash with ₹${(amount / 1000).toFixed(0)}K transaction — MPIN auth from unknown device compound signal.`,
    scoreImpact: 14,
  }),
  circadianAnomaly: () => ({
    severity: "WARNING" as const,
    rule: "Circadian Anomaly",
    detail: "Transaction hour represents <2% of this account's historical activity. Outside normal operating pattern.",
    scoreImpact: 8,
  }),
  suspiciousISP: (isp: string) => ({
    severity: "WARNING" as const,
    rule: "Cloud/Data-Centre ASN",
    detail: `IP traces to ${isp} — a cloud/hosting provider, not a residential ISP. Probable proxy or automated bot.`,
    scoreImpact: 10,
  }),
  deviceDrift: () => ({
    severity: "WARNING" as const,
    rule: "Device Capability Drift",
    detail: "OS family changed + hardware capability mask Hamming distance 4 from last seen device. Possible device spoofing.",
    scoreImpact: 9,
  }),
  deadAccountActivation: () => ({
    severity: "INFO" as const,
    rule: "Dormant Account Reactivation",
    detail: "Account inactive >30 days before this transaction. Monitoring for unusual pattern continuation.",
    scoreImpact: 5,
  }),
};

function makeTriggeredRules(
  risk: number,
  features: ReturnType<typeof makeCorrelatedFeatures>,
  geo: { distanceKm: number; speedKmh: number; isImpossible: boolean; deviceGeo: { city: string }; ipGeo: { city: string } },
  sig: { velocityBurst: number; fanInRatio: number; deviceAging: number; circadianBitmask: number; ispConsistency: number },
  amount: number,
  ip: string,
) {
  const rules: { severity: "CRITICAL" | "WARNING" | "INFO"; rule: string; detail: string; scoreImpact: number }[] = [];

  // ── Critical rules ──
  if (geo.isImpossible) {
    rules.push(RULE_BANK.impossibleTravel(geo.speedKmh, geo.deviceGeo.city, geo.ipGeo.city));
  }
  if (features.graph > 80 && risk > 65) {
    rules.push(RULE_BANK.highGraphRisk());
  }
  if (risk > 80 && Math.random() < 0.45) {
    rules.push(RULE_BANK.relayMulePattern(Math.round(rand(3, 13))));
  }
  if (risk > 75 && features.device > 75 && Math.random() < 0.35) {
    rules.push(RULE_BANK.simSwap());
  }
  if (features.deadAccount > 80 && amount > 20000) {
    rules.push(RULE_BANK.sleepAndFlash());
  }
  if (risk > 78 && Math.random() < 0.30) {
    rules.push(RULE_BANK.circularFlow());
  }

  // ── Warning rules ──
  if (sig.velocityBurst > 68) {
    rules.push(RULE_BANK.velocityBurst(sig.velocityBurst));
  }
  if (sig.fanInRatio > 62) {
    rules.push(RULE_BANK.highFanIn(sig.fanInRatio));
  }
  if (features.device > 72 && amount > 8000 && Math.random() < 0.55) {
    rules.push(RULE_BANK.newDeviceHighAmount(amount));
  }
  if (sig.circadianBitmask < 35) {
    rules.push(RULE_BANK.circadianAnomaly());
  }
  if (ip.includes("3.6") || ip.includes("3.236") || ip.includes("164.52") || ip.includes("164.90") || ip.includes("95.216")) {
    rules.push(RULE_BANK.suspiciousISP(
      ip.includes("3.6") || ip.includes("3.236") ? "AWS" : ip.includes("164.") ? "DigitalOcean" : "Hetzner"
    ));
  } else if (sig.ispConsistency < 35 && risk > 55) {
    rules.push(RULE_BANK.deviceDrift());
  }

  // ── Info rules ──
  if (features.deadAccount > 65 && !rules.some((r) => r.rule === "Sleep-and-Flash Mule")) {
    rules.push(RULE_BANK.deadAccountActivation());
  }

  // Ensure high-risk transactions always have at least one rule
  if (rules.length === 0 && risk >= 65) {
    rules.push(RULE_BANK.velocityBurst(Math.round(rand(50, 75))));
  }

  return rules;
}

// ── Semantic alert messages (tiered by risk) ─────────────────
function makeSemanticAlert(risk: number, geo: { isImpossible: boolean }, features: { graph: number; device: number }): string {
  if (risk < 50) return "";
  if (geo.isImpossible) return "🚨 IMPOSSIBLE TRAVEL — Device and IP geolocations are physically inconsistent. VPN or account compromise likely.";
  if (risk >= 80 && features.graph > 75) return "⚠️ CRITICAL NETWORK RISK — Sender is deeply embedded in a flagged fraud cluster. Relay mule pattern active.";
  if (risk >= 80) return "🚨 HIGH-RISK TRANSACTION — Multiple fraud signals simultaneously active. Immediate review required.";
  if (risk >= 65 && features.device > 70) return "⚠️ SUSPICIOUS DEVICE PROFILE — Device shared across multiple accounts. Possible SIM-swap or mass compromise.";
  if (risk >= 65) return "⚠️ ELEVATED RISK — Behavioral and network anomalies detected. Enhanced monitoring triggered.";
  return "ℹ️ MONITORING — Minor anomalies detected. Transaction flagged for observation.";
}

function makeTransaction(): Transaction {
  const sender = pick(USERS);
  let receiver = pick(USERS);
  if (receiver.id === sender.id) receiver = pick(USERS);
  const risk = sampleRisk();
  // Blocked txns are deliberately small amounts (smurfing / micro-test transfers)
  const amount = Math.round(
    (risk > 75 ? rand(200, 4000) : risk > 50 ? rand(500, 25000) : rand(50, 30000)) * 100
  ) / 100;
  const latency = Math.round(rand(30, 180));

  // ── Geo-realistic IP selection ──────────────────────────
  // Low-risk: IP from same city or nearby residential IP
  // High-risk: IP from distant city or cloud/VPN provider
  const residentialIPs = IPS.filter((i) => i.residential);
  const sameCityIPs = residentialIPs.filter((i) => i.city === sender.city);
  const distantIPs = IPS.filter((i) => i.city !== sender.city);
  const cloudIPs = IPS.filter((i) => !i.residential);

  let ip: typeof IPS[number];
  if (risk > 78 && Math.random() < 0.55) {
    // Critical risk — cloud/VPN exit node
    ip = pick(cloudIPs);
  } else if (risk > 65) {
    // High risk — IP from a different city
    ip = pick(distantIPs.length ? distantIPs : residentialIPs);
  } else if (sameCityIPs.length && Math.random() < 0.7) {
    // Low risk — same-city IP
    ip = pick(sameCityIPs);
  } else {
    ip = pick(residentialIPs);
  }

  // ── Device GPS: sender's real city coords + small GPS jitter ──
  const deviceGeo = {
    city: sender.city,
    lat: sender.lat + rand(-0.015, 0.015),   // ~1.5 km GPS noise
    lng: sender.lng + rand(-0.015, 0.015),
  };

  // ── IP geolocation: resolved from IP's city lookup ──
  const ipCityCoords = CITY_COORDS[ip.city] || { lat: sender.lat, lng: sender.lng };
  const ipGeo = {
    city: ip.city,
    lat: ipCityCoords.lat + rand(-0.05, 0.05),  // IP geolocation ~5 km accuracy
    lng: ipCityCoords.lng + rand(-0.05, 0.05),
  };

  // ── Distance & speed from real city-to-city haversine ──
  const distanceKm = Math.round(haversineKm(deviceGeo, ipGeo) * 10) / 10;
  const timeDeltaMin = risk > 70
    ? Math.round(rand(2, 20) * 10) / 10        // short window → high speed
    : Math.round(rand(30, 480) * 10) / 10;     // long window → plausible speed
  const speedKmh = Math.round((distanceKm / Math.max(0.01, timeDeltaMin / 60)) * 10) / 10;
  const isImpossible = speedKmh > 900;          // faster than commercial flight

  const features = makeCorrelatedFeatures(risk);

  const behavioralSignature = {
    amountEntropy: risk > 70 ? Math.round(rand(60, 95)) : Math.round(rand(30, 75)),
    fanInRatio: risk > 70 ? Math.round(rand(55, 90)) : Math.round(rand(10, 55)),
    temporalAlignment: risk > 70 ? Math.round(rand(20, 65)) : Math.round(rand(60, 95)),
    deviceAging: risk > 70 ? Math.round(rand(10, 50)) : Math.round(rand(50, 95)),
    networkDiversity: risk > 70 ? Math.round(rand(55, 90)) : Math.round(rand(10, 55)),
    velocityBurst: risk > 70 ? Math.round(rand(60, 95)) : Math.round(rand(5, 55)),
    circadianBitmask: risk > 70 ? Math.round(rand(15, 55)) : Math.round(rand(55, 95)),
    ispConsistency: risk > 70 ? Math.round(rand(15, 55)) : Math.round(rand(55, 95)),
  };

  const geoEvidence = { deviceGeo, ipGeo, distanceKm, timeDeltaMin, speedKmh, isImpossible };

  const tx: Transaction = {
    id: `mock-${crypto.randomUUID()}`,
    timestamp: new Date(),
    senderName: sender.name,
    senderUPI: sender.upi,
    receiverName: receiver.name,
    receiverUPI: receiver.upi,
    amount,
    status: riskToStatus(risk),
    riskScore: risk,
    latencyMs: latency,
    senderIP: ip.ip,
    deviceId: `DEV${Math.floor(rand(1, 15)).toString().padStart(4, "0")}`,
    city: sender.city,
    features,
    triggeredRules: makeTriggeredRules(risk, features, geoEvidence, behavioralSignature, amount, ip.ip),
    geoEvidence,
    behavioralSignature,
    semanticAlert: makeSemanticAlert(risk, geoEvidence, features),
    probabilityMatrix: makeProbabilityMatrix(risk, features, geoEvidence),
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
