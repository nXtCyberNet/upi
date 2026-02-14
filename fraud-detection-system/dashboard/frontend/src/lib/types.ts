// ══════════════════════════════════════════════════════════════
// Type Definitions — All TypeScript interfaces for the dashboard
// ══════════════════════════════════════════════════════════════

export interface Transaction {
  id: string;
  timestamp: Date;
  senderName: string;
  senderUPI: string;
  receiverName: string;
  receiverUPI: string;
  amount: number;
  status: "SUCCESS" | "FAILED" | "BLOCKED";
  riskScore: number;
  latencyMs: number;
  senderIP: string;
  deviceId: string;
  city: string;
  features: FeatureScores;
  triggeredRules: TriggeredRule[];
  geoEvidence: GeoEvidence;
  behavioralSignature: BehavioralSignature;
  semanticAlert: string;
  probabilityMatrix: ProbabilityMatrixRow[];
}

export interface FeatureScores {
  graph: number;
  behavioral: number;
  device: number;
  deadAccount: number;
  velocity: number;
}

export interface TriggeredRule {
  severity: "CRITICAL" | "WARNING" | "INFO";
  rule: string;
  detail: string;
  scoreImpact: number;
}

export interface GeoEvidence {
  deviceGeo: { city: string; lat: number; lng: number };
  ipGeo: { city: string; lat: number; lng: number };
  distanceKm: number;
  timeDeltaMin: number;
  speedKmh: number;
  isImpossible: boolean;
}

export interface BehavioralSignature {
  amountEntropy: number;
  fanInRatio: number;
  temporalAlignment: number;
  deviceAging: number;
  networkDiversity: number;
  velocityBurst: number;
  circadianBitmask: number;
  ispConsistency: number;
}

export interface ProbabilityMatrixRow {
  category: string;
  rawValue: string;
  weight: number;
  weightedScore: number;
  scenario: string;
}

export interface GraphNode {
  id: string;
  name: string;
  upi: string;
  type: "user" | "mule" | "aggregator";
  riskScore: number;
  fanIn: number;
  fanOut: number;
  betweennessCentrality: number;
  pageRank: number;
  deviceCount: number;
  city: string;
  lastActive: Date;
  isFlagged: boolean;
  isBlocked: boolean;
  cluster?: number;
  cycleDetected: boolean;
  localClusterCoeff: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  amount: number;
  count: number;
  timestamp: Date;
  is3Hop: boolean;
}

export interface SystemHealth {
  neo4j: {
    activeConnections: number;
    idleConnections: number;
    avgQueryMs: number;
    nodesCount: number;
    relsCount: number;
  };
  redis: {
    streamDepth: number;
    lagMs: number;
    memoryUsedMB: number;
    pendingMessages: number;
  };
  workers: {
    active: number;
    total: number;
    cpuPercent: number;
    ramPercent: number;
    processedPerSec: number;
    wsConnections: number;
  };
  tps: number;
  meanLatencyMs: number;
  uptime: string;
  graphAnalytics: {
    modularity: number;
    clusters: number;
    bfsLatencyMs: number;
  };
  redisWindow: {
    windowSec: number;
    eventsInWindow: number;
  };
}

export interface AggregatorNode {
  id: string;
  name: string;
  upi: string;
  betweennessCentrality: number;
  pageRank: number;
  fanIn: number;
  fanOut: number;
  totalVolume: number;
  riskScore: number;
  flaggedAt: Date;
  cluster: number;
  deviceCount: number;
}

export interface ASNEntry {
  asn: string;
  provider: string;
  txCount: number;
  riskTxCount: number;
  percentage: number;
  isRisky: boolean;
}

export interface DeviceCluster {
  deviceId: string;
  userCount: number;
  users: string[];
  firstSeen: Date;
  lastSeen: Date;
  riskScore: number;
}

export interface LatencyBucket {
  index: number;
  latencyMs: number;
  timestamp: Date;
}

export interface SubgraphNode {
  id: string;
  name: string;
  upi: string;
  level: 0 | 1 | 2 | 3;
  type: "user" | "mule" | "aggregator";
  riskScore: number;
  city: string;
  deviceCount: number;
  fanIn: number;
  fanOut: number;
}

export interface SubgraphEdge {
  source: string;
  target: string;
  amount: number;
  timestamp: Date;
  level: 1 | 2 | 3;
  velocity: number;
}

export interface RealtimeSubgraph {
  txId: string;
  timestamp: Date;
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  reachabilityScore: number;
  circularityIndex: number;
  hopAdjustedVelocity: number;
  cycleDetected: boolean;
  cycleNodes: string[];
  networkPathVelocityMin: number;
  betweennessCentrality: number;
  geoIpConvergence: number;
  identityDensity: number;
}
