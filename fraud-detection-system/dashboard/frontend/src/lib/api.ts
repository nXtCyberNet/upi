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
  SubgraphNode,
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

// City coordinate lookup for resolving IP geolocations
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
  "AWS ap-south-1": { lat: 19.076, lng: 72.8777 },
  "AWS us-east-1": { lat: 39.0438, lng: -77.4874 },
  "DigitalOcean SGP": { lat: 1.3521, lng: 103.8198 },
  "DigitalOcean AMS": { lat: 52.3676, lng: 4.9041 },
  "Hetzner HEL": { lat: 60.1695, lng: 24.9354 },
};

const MOCK_IPS = [
  // Residential ISPs
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
  // Cloud / VPN (non-residential)
  { ip: "3.6.82.140", city: "AWS ap-south-1", provider: "AWS", residential: false },
  { ip: "3.236.112.40", city: "AWS us-east-1", provider: "AWS", residential: false },
  { ip: "164.52.192.76", city: "DigitalOcean SGP", provider: "DigitalOcean", residential: false },
  { ip: "164.90.200.11", city: "DigitalOcean AMS", provider: "DigitalOcean", residential: false },
  { ip: "95.216.44.88", city: "Hetzner HEL", provider: "Hetzner", residential: false },
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

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── Correlated feature scores tied to risk ────────────────────
function mockCorrelatedFeatures(risk: number) {
  const base = risk > 75 ? 55 : risk > 55 ? 35 : risk > 35 ? 20 : 10;
  const ceiling = risk > 75 ? 98 : risk > 55 ? 80 : risk > 35 ? 65 : 55;
  const s = () => Math.round(rand(base, ceiling));
  return { graph: s(), behavioral: s(), device: s(), deadAccount: s(), velocity: s() };
}

// ── Probability matrix (5 categories) ────────────────────────
function mockProbabilityMatrix(
  risk: number,
  features: { graph: number; behavioral: number; device: number; deadAccount: number; velocity: number },
  geo: { distanceKm: number; speedKmh: number; isImpossible: boolean; deviceGeo: { city: string }; ipGeo: { city: string } },
) {
  const intRaw = Math.min(100, features.graph * 0.5 + risk * 0.5);
  const geoRaw = geo.isImpossible ? Math.round(rand(85, 98)) : Math.min(100, geo.speedKmh > 180 ? Math.round(rand(55, 80)) : Math.round(rand(5, 40)));
  return [
    { category: "Integrity", rawValue: `${intRaw.toFixed(0)}/100`, weight: 0.30, weightedScore: Math.round(intRaw * 0.30 * 10) / 10, scenario: intRaw > 70 ? "Significant deviation from account baseline" : "Within baseline parameters" },
    { category: "Geo-Spatial", rawValue: geo.isImpossible ? `${geo.speedKmh.toFixed(0)} km/h IMPOSSIBLE` : `${geo.distanceKm.toFixed(0)} km offset`, weight: 0.20, weightedScore: Math.round(geoRaw * 0.20 * 10) / 10, scenario: geo.isImpossible ? `VPN suspected: ${geo.deviceGeo.city} → ${geo.ipGeo.city}` : geoRaw > 50 ? "Suspicious IP discrepancy" : "Normal geographic activity" },
    { category: "Behavioral", rawValue: `${features.behavioral}/100 anomaly`, weight: 0.25, weightedScore: Math.round(features.behavioral * 0.25 * 10) / 10, scenario: features.behavioral > 70 ? "Multiple simultaneous behavioral anomalies" : features.behavioral > 45 ? "Elevated velocity / amount entropy" : "Normal behavioural pattern" },
    { category: "Phishing", rawValue: `${Math.round(features.device * 0.6 + features.deadAccount * 0.4)}/100`, weight: 0.15, weightedScore: Math.round(Math.min(100, features.device * 0.6 + features.deadAccount * 0.4) * 0.15 * 10) / 10, scenario: features.device > 70 ? "High-risk device or dormant account" : "Normal device / account profile" },
    { category: "Temporal", rawValue: `Burst: ${features.velocity}/100`, weight: 0.10, weightedScore: Math.round(features.velocity * 0.10 * 10) / 10, scenario: features.velocity > 70 ? "Burst pattern detected" : "Normal inter-transaction timing" },
  ];
}

// ── Contextual triggered rules ────────────────────────────────
function mockTriggeredRules(
  risk: number,
  features: { graph: number; device: number; deadAccount: number; velocity: number },
  geo: { speedKmh: number; isImpossible: boolean; deviceGeo: { city: string }; ipGeo: { city: string } },
  amount: number,
  ip: string,
) {
  const rules: Array<{ severity: "CRITICAL" | "WARNING" | "INFO"; rule: string; detail: string; scoreImpact: number }> = [];
  if (geo.isImpossible) rules.push({ severity: "CRITICAL", rule: "Impossible Travel Detected", detail: `Device in ${geo.deviceGeo.city} but IP from ${geo.ipGeo.city} implies ${geo.speedKmh.toFixed(0)} km/h.`, scoreImpact: 25 });
  if (features.graph > 80 && risk > 65) rules.push({ severity: "CRITICAL", rule: "Fraud Network Connection", detail: "Sender is 2 hops from flagged mule cluster (Louvain community match).", scoreImpact: 20 });
  if (risk > 80 && Math.random() < 0.45) rules.push({ severity: "CRITICAL", rule: "Relay Mule Pattern", detail: `Funds traversed L1→L3 in ${Math.round(rand(3, 13)).toFixed(0)} min — automated layering.`, scoreImpact: 22 });
  if (features.deadAccount > 80 && amount > 20000) rules.push({ severity: "CRITICAL", rule: "Sleep-and-Flash Mule", detail: "Account dormant >30 days then transacts ≥50× historical average.", scoreImpact: 20 });
  if (risk > 75 && features.device > 72 && Math.random() < 0.35) rules.push({ severity: "CRITICAL", rule: "SIM-Swap Multi-User", detail: "Device hash shared by >3 distinct UPI accounts in 24h.", scoreImpact: 18 });
  if (features.velocity > 68) rules.push({ severity: "WARNING", rule: "Velocity Burst Anomaly", detail: `Send-rate ${features.velocity}/100 — ${features.velocity > 80 ? "5×" : "3×"} the 30-day rolling average.`, scoreImpact: 12 });
  if (ip.includes("3.6") || ip.includes("3.236") || ip.includes("164.52") || ip.includes("164.90") || ip.includes("95.216")) rules.push({ severity: "WARNING", rule: "Cloud/Data-Centre ASN", detail: `IP ${ip} traces to a cloud/hosting provider — not a residential ISP.`, scoreImpact: 10 });
  if (risk >= 60 && rules.length === 0) rules.push({ severity: "WARNING", rule: "Composite Threshold Breach", detail: "Weighted risk sum exceeded 60 — manual review recommended.", scoreImpact: 8 });
  return rules;
}

// Realistic skewed distribution: 85% low (5-50), 12% moderate (50-72), 3% high (72-92)
function sampleRisk(): number {
  const roll = Math.random();
  if (roll < 0.85) return Math.round(rand(5, 50) * 100) / 100;
  if (roll < 0.97) return Math.round(rand(50, 72) * 100) / 100;
  return Math.round(rand(72, 92) * 100) / 100;
}

function mockTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const sender = pick(MOCK_USERS);
  let receiver = pick(MOCK_USERS);
  if (receiver.id === sender.id) receiver = pick(MOCK_USERS);
  const risk = sampleRisk();
  // Blocked txns are small (smurfing/test transfers); high-risk are also capped
  const amount = Math.round(
    (risk > 75 ? rand(200, 4000) : risk > 50 ? rand(500, 25000) : rand(50, 30000)) * 100
  ) / 100;
  const latency = Math.round(rand(30, 160));
  // Only block extreme-risk txns, ~25% of those → yields ~0.5-1% BLOCKED per 1000 txns
  const status: Transaction["status"] = (risk >= 80 && Math.random() < 0.25) ? "BLOCKED" : risk < 5 ? "FAILED" : "SUCCESS";

  // ── Geo-realistic IP selection ──
  const residentialIPs = MOCK_IPS.filter((i) => i.residential);
  const sameCityIPs = residentialIPs.filter((i) => i.city === sender.city);
  const distantIPs = MOCK_IPS.filter((i) => i.city !== sender.city);
  const cloudIPs = MOCK_IPS.filter((i) => !i.residential);

  let ip: typeof MOCK_IPS[number];
  if (risk > 78 && Math.random() < 0.55) {
    ip = pick(cloudIPs);
  } else if (risk > 65) {
    ip = pick(distantIPs.length ? distantIPs : residentialIPs);
  } else if (sameCityIPs.length && Math.random() < 0.7) {
    ip = pick(sameCityIPs);
  } else {
    ip = pick(residentialIPs);
  }

  // Device GPS: sender's real city coordinates + small jitter
  const deviceGeo = {
    city: sender.city,
    lat: sender.lat + rand(-0.015, 0.015),
    lng: sender.lng + rand(-0.015, 0.015),
  };

  // IP geolocation: resolved from the IP's city
  const ipCityCoords = CITY_COORDS[ip.city] || { lat: sender.lat, lng: sender.lng };
  const ipGeo = {
    city: ip.city,
    lat: ipCityCoords.lat + rand(-0.05, 0.05),
    lng: ipCityCoords.lng + rand(-0.05, 0.05),
  };

  // Real haversine distance between device and IP locations
  const distanceKm = Math.round(haversineKm(deviceGeo, ipGeo) * 10) / 10;
  const timeDeltaMin = risk > 70
    ? Math.round(rand(2, 20) * 10) / 10
    : Math.round(rand(30, 480) * 10) / 10;
  const speedKmh = Math.round((distanceKm / Math.max(0.01, timeDeltaMin / 60)) * 10) / 10;
  const isImpossible = speedKmh > 900;

  const features = mockCorrelatedFeatures(risk);
  const geoEvidence = { deviceGeo, ipGeo, distanceKm, timeDeltaMin, speedKmh, isImpossible };

  return {
    id: `mock-${crypto.randomUUID()}`,
    timestamp: new Date(),
    senderName: sender.name,
    senderUPI: sender.upi,
    receiverName: receiver.name,
    receiverUPI: receiver.upi,
    amount,
    status,
    riskScore: risk,
    latencyMs: latency,
    senderIP: ip.ip,
    deviceId: `DEV${Math.floor(rand(1, 15)).toString().padStart(4, "0")}`,
    city: sender.city,
    features,
    triggeredRules: mockTriggeredRules(risk, features, geoEvidence, amount, ip.ip),
    geoEvidence,
    behavioralSignature: {
      amountEntropy: risk > 70 ? Math.round(rand(60, 95)) : Math.round(rand(30, 75)),
      fanInRatio: risk > 70 ? Math.round(rand(55, 90)) : Math.round(rand(10, 55)),
      temporalAlignment: risk > 70 ? Math.round(rand(20, 65)) : Math.round(rand(60, 95)),
      deviceAging: risk > 70 ? Math.round(rand(10, 50)) : Math.round(rand(50, 95)),
      networkDiversity: risk > 70 ? Math.round(rand(55, 90)) : Math.round(rand(10, 55)),
      velocityBurst: risk > 70 ? Math.round(rand(60, 95)) : Math.round(rand(5, 55)),
      circadianBitmask: risk > 70 ? Math.round(rand(15, 55)) : Math.round(rand(55, 95)),
      ispConsistency: risk > 70 ? Math.round(rand(15, 55)) : Math.round(rand(55, 95)),
    },
    semanticAlert: risk >= 80 ? (isImpossible ? "🚨 IMPOSSIBLE TRAVEL — VPN or device compromise suspected." : "🚨 HIGH-RISK — Multiple fraud signals simultaneously active.") : risk >= 65 ? "⚠️ ELEVATED RISK — Behavioral and network anomalies detected." : risk >= 50 ? "ℹ️ MONITORING — Minor anomalies flagged for observation." : "",
    probabilityMatrix: mockProbabilityMatrix(risk, features, geoEvidence),
    ...overrides,
  };
}

let mockGraphCache: { nodes: GraphNode[]; edges: GraphEdge[] } | null = null;

function mockGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (mockGraphCache) return mockGraphCache;
  const nodes: GraphNode[] = MOCK_USERS.map((u) => {
    const risk = sampleRisk();
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
  const isHighRisk = center.riskScore >= 60;
  const isCritical = center.riskScore >= 78;

  const neighbors = nodes.filter((n) => n.id !== center.id).slice(0, isHighRisk ? 8 : 5);
  const subNodes: SubgraphNode[] = [center, ...neighbors].map((n, i) => ({
    id: n.id,
    name: n.name,
    upi: n.upi,
    level: (i === 0 ? 0 : ((i % 3) + 1)) as 0 | 1 | 2 | 3,
    type: n.type,
    riskScore: n.riskScore,
    city: n.city,
    deviceCount: n.deviceCount,
    fanIn: n.fanIn,
    fanOut: n.fanOut,
  }));
  const subNodeIds = new Set(subNodes.map((n) => n.id));
  const subEdges = edges
    .filter((e) => subNodeIds.has(e.source) && subNodeIds.has(e.target))
    .slice(0, isHighRisk ? 12 : 6)
    .map((e, i) => ({
      source: e.source,
      target: e.target,
      amount: e.amount,
      timestamp: e.timestamp,
      level: ((i % 3) + 1) as 1 | 2 | 3,
      velocity: Math.round(rand(isHighRisk ? 200 : 50, isHighRisk ? 900 : 400)),
    }));

  const cycleDetected = isCritical ? Math.random() < 0.65 : isHighRisk ? Math.random() < 0.35 : Math.random() < 0.1;
  const cycleNodes = cycleDetected ? subNodes.filter((n) => n.riskScore >= 55).map((n) => n.id).slice(0, 4) : [];

  return {
    txId: `mock-${nodeId}`,
    timestamp: new Date(),
    nodes: subNodes,
    edges: subEdges,
    reachabilityScore: isCritical ? Math.round(rand(3.5, 6.5) * 100) / 100 : isHighRisk ? Math.round(rand(1.5, 3.5) * 100) / 100 : Math.round(rand(0.3, 1.5) * 100) / 100,
    circularityIndex: isCritical ? Math.round(rand(0.55, 0.90) * 1000) / 1000 : isHighRisk ? Math.round(rand(0.30, 0.60) * 1000) / 1000 : Math.round(rand(0.05, 0.30) * 1000) / 1000,
    hopAdjustedVelocity: isCritical ? Math.round(rand(400, 900)) : Math.round(rand(80, 400)),
    cycleDetected,
    cycleNodes,
    networkPathVelocityMin: isCritical ? Math.round(rand(2, 12)) : isHighRisk ? Math.round(rand(10, 28)) : Math.round(rand(30, 90)),
    betweennessCentrality: isCritical ? Math.round(rand(0.6, 1.8) * 1000) / 1000 : Math.round(rand(0.01, 0.6) * 1000) / 1000,
    geoIpConvergence: isCritical ? Math.round(rand(0.65, 0.95) * 1000) / 1000 : Math.round(rand(0.1, 0.55) * 1000) / 1000,
    identityDensity: isCritical ? Math.round(rand(3.5, 7) * 10) / 10 : Math.round(rand(1.0, 3.0) * 10) / 10,
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
