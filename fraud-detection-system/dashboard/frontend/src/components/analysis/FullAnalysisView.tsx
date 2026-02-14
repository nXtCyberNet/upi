"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import * as d3 from "d3";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";
import type { Transaction, RealtimeSubgraph, SubgraphNode, SubgraphEdge } from "@/lib/types";
import { fetchSubgraph, fetchNodeTransactions } from "@/lib/api";
import { getRiskColor, getRiskLabel, getRiskBadgeClass, formatINR } from "@/lib/utils";
import { GeodesicArcMap } from "../intelligence/GeodesicArcMap";
import { ProbabilityMatrix } from "../intelligence/ProbabilityMatrix";
import { SemanticAlert } from "../intelligence/SemanticAlert";
import { IntelligencePanel } from "../intelligence/IntelligencePanel";
import { ResizableSidebar } from "../ui/ResizableSidebar";
import {
  X, Globe, Cpu, TrendingUp, Network, AlertTriangle, Crosshair,
  GitBranch, Activity, Zap, Route, RefreshCcw, Timer, Shield, Brain,
  ArrowLeft, ExternalLink, Copy, Clock, MapPin, Smartphone, Fingerprint,
  Eye, Sparkles, Loader2, ChevronRight, Users, Workflow,
} from "lucide-react";

interface FullAnalysisViewProps {
  transaction: Transaction;
  onClose: () => void;
}

// ── AI Analysis types ────────────────────────────────────────
interface AIAnalysisResult {
  summary: string;
  riskVerdict: string;
  issues: { severity: "critical" | "warning" | "info"; title: string; explanation: string }[];
  possibilities: string[];
  recommendation: string;
}

// ── Normal 8-axis profile ────────────────────────────────────
const NORMAL_8: Record<string, number> = {
  "Amt Entropy": 72, "Fan-In": 25, "Temporal": 80, "Device Age": 85,
  "ASN Div": 20, "Vel. Burst": 15, "Circadian": 80, "ISP Cons.": 85,
};

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getGeoRiskProbability(speedKmh: number) {
  if (speedKmh <= 250) return { tier: "PLAUSIBLE", probability: 0, color: "#10b981" };
  if (speedKmh <= 800) return { tier: "SUSPICIOUS", probability: 0.45, color: "#f59e0b" };
  return { tier: "IMPOSSIBLE", probability: 0.95, color: "#ef4444" };
}

// ── Client-side AI summary fallback ──
function generateFallbackAISummary(tx: Transaction, subgraph: RealtimeSubgraph | null): AIAnalysisResult {
  const issues: AIAnalysisResult["issues"] = [];
  const possibilities: string[] = [];

  // Analyze risk score
  if (tx.riskScore >= 80) {
    issues.push({ severity: "critical", title: "Extremely High Risk Score", explanation: `This transaction scored ${tx.riskScore}/100 on our risk engine, placing it in the top percentile of dangerous transactions. Multiple fraud indicators are firing simultaneously.` });
  } else if (tx.riskScore >= 60) {
    issues.push({ severity: "warning", title: "Elevated Risk Score", explanation: `This transaction scored ${tx.riskScore}/100, which is above the normal threshold and warrants attention.` });
  }

  // Geo evidence
  if (tx.geoEvidence.isImpossible) {
    issues.push({ severity: "critical", title: "Impossible Geographic Movement", explanation: `The device location (${tx.geoEvidence.deviceGeo.city}) and IP location (${tx.geoEvidence.ipGeo.city}) are ${tx.geoEvidence.distanceKm.toFixed(0)}km apart. At ${tx.geoEvidence.speedKmh.toFixed(0)} km/h implied speed, this movement is physically impossible — strongly indicating VPN/proxy usage or a compromised account.` });
  } else if (tx.geoEvidence.distanceKm > 100) {
    issues.push({ severity: "warning", title: "Suspicious Geographic Discrepancy", explanation: `Device and IP are ${tx.geoEvidence.distanceKm.toFixed(0)}km apart, suggesting the sender may not be where they claim to be.` });
  }

  // Graph metrics
  if (subgraph?.cycleDetected) {
    issues.push({ severity: "critical", title: "Circular Money Flow Detected", explanation: `Money is flowing in a loop through ${subgraph?.cycleNodes?.length ?? 0} accounts, which is a strong indicator of wash trading or money laundering. The funds eventually return close to their origin.` });
  }
  if ((subgraph?.reachabilityScore ?? 0) > 3) {
    issues.push({ severity: "warning", title: "High Network Reachability", explanation: `This account can reach ${(subgraph?.reachabilityScore ?? 0).toFixed(1)}x more accounts than normal, suggesting it may be part of a coordinated fraud ring.` });
  }
  if ((subgraph?.circularityIndex ?? 0) > 0.5) {
    issues.push({ severity: "warning", title: "Elevated Circularity Index", explanation: `${((subgraph?.circularityIndex ?? 0) * 100).toFixed(0)}% of transaction paths show circular patterns — money is being moved in ways that try to disguise its origin.` });
  }
  if ((subgraph?.networkPathVelocityMin ?? 30) < 15) {
    issues.push({ severity: "critical", title: "Relay Mule Pattern", explanation: `Funds are moving from Layer 1 to Layer 3 in under 15 minutes (${(subgraph?.networkPathVelocityMin ?? 30).toFixed(1)} min), characteristic of an automated relay mule network.` });
  }

  // Behavioral
  if (tx.behavioralSignature.velocityBurst > 70) {
    issues.push({ severity: "warning", title: "Velocity Burst Anomaly", explanation: `The sender is making transactions much faster than their historical pattern. This sudden burst of activity often precedes account drain attacks.` });
  }
  if (tx.behavioralSignature.fanInRatio > 60) {
    issues.push({ severity: "warning", title: "High Fan-In Concentration", explanation: `This account is receiving funds from an unusually large number of sources, which is characteristic of a money mule or aggregator account.` });
  }

  // Device & features
  if (tx.features.device > 70) {
    issues.push({ severity: "warning", title: "Suspicious Device Profile", explanation: `The device used for this transaction has a high risk score (${tx.features.device}/100), possibly due to a new/unknown device, rooted phone, or shared device across multiple accounts.` });
  }
  if (tx.features.deadAccount > 60) {
    issues.push({ severity: "info", title: "Dormant Account Activity", explanation: `This account was previously dormant and has recently become active, which can indicate a compromised or sold account being used for fraud.` });
  }

  // Triggered rules
  tx.triggeredRules.forEach((rule) => {
    if (rule.severity === "CRITICAL") {
      issues.push({ severity: "critical", title: rule.rule, explanation: rule.detail });
    }
  });

  // Possibilities
  if (tx.amount > 50000) possibilities.push("Large-value transaction could be a legitimate business payment or a high-value fraud attempt");
  if (tx.riskScore >= 60 && tx.riskScore < 80) possibilities.push("Score is borderline — could be a false positive triggered by unusual but legitimate travel or device change");
  if ((subgraph?.nodes ?? []).some((n) => n.type === "mule")) possibilities.push("Network contains identified mule accounts — this transaction may be part of a larger layering operation");
  if ((subgraph?.nodes ?? []).some((n) => n.type === "aggregator")) possibilities.push("Aggregator node detected in the network — funds may be consolidating before withdrawal");
  possibilities.push("If this is a recurring pattern for this sender, consider escalating to a full investigation");
  possibilities.push("Check if the receiver account shows similar patterns with other senders");

  // Summary
  const critCount = issues.filter((i) => i.severity === "critical").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;
  const riskVerdict = critCount >= 2 ? "HIGH RISK — Immediate Action Required" : critCount === 1 ? "ELEVATED — Review Recommended" : warnCount >= 2 ? "MODERATE — Monitor Closely" : "LOW — Within Normal Parameters";

  const summary = critCount >= 2
    ? `This transaction raises ${critCount} critical and ${warnCount} warning flags. The combination of ${issues.slice(0, 2).map((i) => i.title.toLowerCase()).join(" and ")} creates a high-confidence fraud signal. Immediate investigation is recommended.`
    : critCount === 1
    ? `One critical issue was found: ${issues.find((i) => i.severity === "critical")?.title.toLowerCase()}. Combined with ${warnCount} additional warnings, this transaction should be reviewed by a fraud analyst.`
    : `This transaction shows ${warnCount} warning indicators. While none individually are conclusive, the combined pattern warrants monitoring.`;

  const recommendation = critCount >= 2
    ? "BLOCK this transaction immediately and freeze both accounts pending investigation. Alert the compliance team and file a suspicious activity report."
    : critCount === 1
    ? "HOLD this transaction for manual review. Contact the sender to verify the transaction details before processing."
    : warnCount >= 2
    ? "Allow the transaction but add both accounts to the enhanced monitoring list for the next 30 days."
    : "No immediate action required. Continue standard monitoring.";

  return { summary, riskVerdict, issues, possibilities, recommendation };
}

export function FullAnalysisView({ transaction: tx, onClose }: FullAnalysisViewProps) {
  const riskColor = getRiskColor(tx.riskScore);
  const riskLabel = getRiskLabel(tx.riskScore);
  const geo = tx.geoEvidence;
  const sig = tx.behavioralSignature;
  const isHighRisk = tx.riskScore >= 60;

  const subgraphUserId = tx.senderName || tx.id;
  const [subgraph, setSubgraph] = useState<RealtimeSubgraph | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSubgraph(subgraphUserId).then((sg) => { if (!cancelled) setSubgraph(sg); }).catch(() => {});
    return () => { cancelled = true; };
  }, [subgraphUserId]);

  // ── Node interaction state ──
  const [selectedNode, setSelectedNode] = useState<SubgraphNode | null>(null);
  const [nodeTransactions, setNodeTransactions] = useState<Transaction[]>([]);
  const [showNodeDrawer, setShowNodeDrawer] = useState(false);
  const [nodeSidebarTx, setNodeSidebarTx] = useState<Transaction | null>(null);
  const [showNodeSidebar, setShowNodeSidebar] = useState(false);

  // ── Node context menu ──
  const [nodeContextMenu, setNodeContextMenu] = useState<{
    x: number; y: number; node: SubgraphNode;
  } | null>(null);

  // ── AI Analysis state ──
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Handle node click — show transactions for that node
  const handleNodeClick = useCallback(async (node: SubgraphNode) => {
    setSelectedNode(node);
    setShowNodeDrawer(true);
    setNodeContextMenu(null);
    try {
      const txs = await fetchNodeTransactions(node.id, 10);
      setNodeTransactions(txs);
    } catch {
      setNodeTransactions([]);
    }
  }, []);

  // Handle node right-click — context menu
  const handleNodeContextMenu = useCallback((e: React.MouseEvent | MouseEvent, node: SubgraphNode) => {
    e.preventDefault();
    e.stopPropagation();
    setNodeContextMenu({ x: (e as MouseEvent).clientX || (e as React.MouseEvent).clientX, y: (e as MouseEvent).clientY || (e as React.MouseEvent).clientY, node });
  }, []);

  // Open sidebar analysis for a node's transaction
  const handleNodeTxSidebar = useCallback((ntx: Transaction) => {
    setNodeSidebarTx(ntx);
    setShowNodeSidebar(true);
  }, []);

  // Close node context menu on outside click
  useEffect(() => {
    if (!nodeContextMenu) return;
    const close = () => setNodeContextMenu(null);
    const closeKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNodeContextMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeKey);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", closeKey); };
  }, [nodeContextMenu]);

  // ── AI Analysis request ──
  const requestAIAnalysis = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const payload = {
        transaction_id: tx.id,
        risk_score: tx.riskScore,
        amount: tx.amount,
        sender: { name: tx.senderName || "", upi: tx.senderUPI || "" },
        receiver: { name: tx.receiverName || "", upi: tx.receiverUPI || "" },
        city: tx.city || "",
        status: tx.status,
        features: tx.features,
        triggered_rules: tx.triggeredRules,
        geo_evidence: {
          device_city: tx.geoEvidence.deviceGeo.city,
          ip_city: tx.geoEvidence.ipGeo.city,
          distance_km: tx.geoEvidence.distanceKm,
          speed_kmh: tx.geoEvidence.speedKmh,
          is_impossible: tx.geoEvidence.isImpossible,
        },
        behavioral_signature: tx.behavioralSignature,
        graph_metrics: {
          reachability: subgraph?.reachabilityScore ?? 0,
          circularity: subgraph?.circularityIndex ?? 0,
          hop_velocity: subgraph?.hopAdjustedVelocity ?? 0,
          cycle_detected: subgraph?.cycleDetected ?? false,
          betweenness: subgraph?.betweennessCentrality ?? 0,
          nodes_count: subgraph?.nodes?.length ?? 0,
          edges_count: subgraph?.edges?.length ?? 0,
        },
      };

      const res = await fetch("/api/analysis/ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data: AIAnalysisResult = await res.json();
      setAiAnalysis(data);
    } catch (err: any) {
      setAiError(err.message || "Failed to connect to analysis server");
      // Generate a client-side fallback summary
      setAiAnalysis(generateFallbackAISummary(tx, subgraph));
    } finally {
      setAiLoading(false);
    }
  }, [tx, subgraph]);

  // Geo computation
  const haversineDist = haversine(geo.deviceGeo.lat, geo.deviceGeo.lng, geo.ipGeo.lat, geo.ipGeo.lng);
  const velocity = geo.timeDeltaMin > 0 ? (haversineDist / geo.timeDeltaMin) * 60 : 0;
  const riskProb = getGeoRiskProbability(velocity);

  // 8-axis radar
  const radarData = [
    { axis: "Amt Entropy", current: sig.amountEntropy, normal: NORMAL_8["Amt Entropy"] },
    { axis: "Fan-In", current: sig.fanInRatio, normal: NORMAL_8["Fan-In"] },
    { axis: "Temporal", current: sig.temporalAlignment, normal: NORMAL_8["Temporal"] },
    { axis: "Device Age", current: sig.deviceAging, normal: NORMAL_8["Device Age"] },
    { axis: "ASN Div", current: sig.networkDiversity, normal: NORMAL_8["ASN Div"] },
    { axis: "Vel. Burst", current: sig.velocityBurst, normal: NORMAL_8["Vel. Burst"] },
    { axis: "Circadian", current: sig.circadianBitmask, normal: NORMAL_8["Circadian"] },
    { axis: "ISP Cons.", current: sig.ispConsistency, normal: NORMAL_8["ISP Cons."] },
  ];
  const totalDeviation = radarData.reduce((s, d) => s + Math.abs(d.current - d.normal), 0);
  const avgDeviation = totalDeviation / radarData.length;

  // Graph metrics
  const reachScore = subgraph?.reachabilityScore ?? 0;
  const circIdx = subgraph?.circularityIndex ?? 0;
  const hopVelocity = subgraph?.hopAdjustedVelocity ?? 0;
  const netPathMin = subgraph?.networkPathVelocityMin ?? 30;
  const isRelayPattern = netPathMin < 15;

  // Subgraph D3 viz — interactive
  const graphRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<(SubgraphNode & d3.SimulationNodeDatum)[]>([]);
  useEffect(() => {
    const svg = graphRef.current;
    if (!svg || !subgraph) return;
    const w = svg.clientWidth || 600;
    const h = 340;
    const sel = d3.select(svg);
    sel.selectAll("*").remove();
    sel.attr("viewBox", `0 0 ${w} ${h}`);

    const nodes: (SubgraphNode & d3.SimulationNodeDatum)[] = subgraph.nodes.map((n) => ({ ...n }));
    nodesRef.current = nodes;
    const edges: (SubgraphEdge & { source: any; target: any })[] = subgraph.edges.map((e) => ({ ...e }));

    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges).id((d: any) => d.id).distance(60))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(w / 2, h / 2))
      .force("collision", d3.forceCollide().radius(20));

    // Edges
    const edgeSel = sel.selectAll<SVGLineElement, SubgraphEdge>("line.edge")
      .data(edges).join("line").attr("class", "edge")
      .attr("stroke", (d: any) => d.level === 1 ? "#38bdf880" : d.level === 2 ? "#a78bfa60" : "#ef444450")
      .attr("stroke-width", (d: any) => 4 - d.level)
      .attr("stroke-dasharray", (d: any) => d.level === 3 ? "4 3" : "");

    // Nodes — now clickable and right-clickable
    const nodeSel = sel.selectAll<SVGCircleElement, SubgraphNode>("circle.node")
      .data(nodes).join("circle").attr("class", "node")
      .attr("r", (d) => d.level === 0 ? 14 : d.level === 1 ? 10 : d.level === 2 ? 7 : 6)
      .attr("fill", (d) => d.type === "aggregator" ? "#ef4444" : d.type === "mule" ? "#f59e0b" : "#38bdf8")
      .attr("stroke", (d) => selectedNode?.id === d.id ? "#f1f5f9" : "#020617")
      .attr("stroke-width", (d) => selectedNode?.id === d.id ? 3 : 2)
      .attr("opacity", (d) => d.level === 0 ? 1 : d.level === 1 ? 0.9 : 0.7)
      .style("cursor", "pointer")
      .on("click", (_event: any, d: any) => {
        handleNodeClick(d as SubgraphNode);
      })
      .on("contextmenu", (event: any, d: any) => {
        event.preventDefault();
        event.stopPropagation();
        // Get the SVG's bounding rect to calculate absolute position
        const svgRect = svg.getBoundingClientRect();
        const absX = svgRect.left + (d.x / w) * svgRect.width;
        const absY = svgRect.top + (d.y / h) * svgRect.height;
        setNodeContextMenu({ x: absX, y: absY, node: d as SubgraphNode });
      });

    // Hover glow
    nodeSel
      .on("mouseenter", function (_, d: any) {
        d3.select(this)
          .transition().duration(150)
          .attr("r", (d.level === 0 ? 14 : d.level === 1 ? 10 : d.level === 2 ? 7 : 6) + 3)
          .attr("stroke", "#f1f5f9").attr("stroke-width", 3);
      })
      .on("mouseleave", function (_, d: any) {
        d3.select(this)
          .transition().duration(150)
          .attr("r", d.level === 0 ? 14 : d.level === 1 ? 10 : d.level === 2 ? 7 : 6)
          .attr("stroke", selectedNode?.id === d.id ? "#f1f5f9" : "#020617")
          .attr("stroke-width", selectedNode?.id === d.id ? 3 : 2);
      });

    // Drag behavior
    const drag = d3.drag<SVGCircleElement, SubgraphNode & d3.SimulationNodeDatum>()
      .on("start", (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on("end", (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; });
    nodeSel.call(drag as any);

    // Labels
    const labelSel = sel.selectAll<SVGTextElement, SubgraphNode>("text.label")
      .data(nodes.filter((n) => n.level <= 1)).join("text").attr("class", "label")
      .attr("fill", "#94a3b8").attr("font-size", 9).attr("font-family", "'JetBrains Mono', monospace")
      .attr("text-anchor", "middle").attr("dy", -14)
      .text((d) => d.name.split(" ")[0] || d.id.slice(0, 8))
      .style("pointer-events", "none");

    sim.on("tick", () => {
      edgeSel.attr("x1", (d: any) => d.source.x).attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x).attr("y2", (d: any) => d.target.y);
      nodeSel.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
      labelSel.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
    });

    return () => { sim.stop(); };
  }, [subgraph, selectedNode?.id, handleNodeClick]);

  return (
    <div className="fixed inset-0 z-[80] bg-[#020617] overflow-y-auto">
      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-[#020617]/95 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <button onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#0f172a] border border-slate-800 text-[#94a3b8] hover:text-[#f1f5f9] hover:border-slate-700 transition-all">
            <ArrowLeft size={14} />
            Back to Dashboard
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#a78bfa] to-[#38bdf8] flex items-center justify-center">
              <Brain size={14} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-[#f1f5f9]">Deep Transaction Analysis</h1>
              <p className="text-[10px] font-mono text-[#64748b]">{tx.id}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-bold px-3 py-1.5 rounded-lg ${getRiskBadgeClass(tx.riskScore)}`}>
            {riskLabel} — {tx.riskScore}
          </span>
          <span className={`text-[10px] font-bold px-2 py-1 rounded ${
            tx.status === "BLOCKED" ? "bg-red-500/15 text-red-400 border border-red-500/30"
            : tx.status === "SUCCESS" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
            : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
          }`}>{tx.status}</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#1e293b] text-[#64748b] hover:text-[#f1f5f9] transition-colors">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
        {/* ── Semantic Alert ── */}
        {tx.semanticAlert && <SemanticAlert alert={tx.semanticAlert} />}

        {/* ═══ ROW 1: Transaction Summary + Quick Stats ═══ */}
        <div className="grid grid-cols-4 gap-4">
          {/* Tx Card */}
          <div className="col-span-2 bg-[#0f172a] rounded-xl border border-slate-800 p-5">
            <h3 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">Transaction Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <InfoRow icon={<Fingerprint size={12} />} label="TX ID" value={tx.id} mono />
                <InfoRow icon={<Clock size={12} />} label="Timestamp" value={tx.timestamp.toLocaleString()} />
                <InfoRow icon={<MapPin size={12} />} label="City" value={tx.city} />
                <InfoRow icon={<Smartphone size={12} />} label="Device" value={tx.deviceId.slice(0, 16)} mono />
              </div>
              <div className="space-y-3">
                <InfoRow icon={<Activity size={12} />} label="Sender" value={tx.senderName || "—"} sub={tx.senderUPI || "—"} />
                <InfoRow icon={<Activity size={12} />} label="Receiver" value={tx.receiverName || "—"} sub={tx.receiverUPI || "—"} />
                <InfoRow icon={<Zap size={12} />} label="Amount" value={formatINR(tx.amount)} highlight />
                <InfoRow icon={<Timer size={12} />} label="Latency" value={`${tx.latencyMs}ms`} />
              </div>
            </div>
          </div>

          {/* Risk Fusion */}
          <div className="bg-[#0f172a] rounded-xl border border-slate-800 p-5">
            <h3 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">Risk Fusion Formula</h3>
            <div className="space-y-2 font-mono text-[11px]">
              {[
                { w: 0.30, label: "Graph", score: tx.features.graph, color: "#a78bfa" },
                { w: 0.25, label: "Behavioral", score: tx.features.behavioral, color: "#38bdf8" },
                { w: 0.20, label: "Device", score: tx.features.device, color: "#22d3ee" },
                { w: 0.15, label: "Dead Acct", score: tx.features.deadAccount, color: "#f59e0b" },
                { w: 0.10, label: "Velocity", score: tx.features.velocity, color: "#ef4444" },
              ].map((f) => (
                <div key={f.label} className="flex items-center justify-between">
                  <span className="text-[#64748b]">{f.w.toFixed(2)} × <span style={{ color: f.color }}>{f.label}</span></span>
                  <span className="text-[#94a3b8]">{(f.w * f.score).toFixed(1)}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                <span className="text-[#f1f5f9] font-semibold">R =</span>
                <span className="text-xl font-bold" style={{ color: riskColor }}>{tx.riskScore}</span>
              </div>
            </div>
            {/* Mini bar chart of 5 features */}
            <div className="flex items-end gap-1 mt-3 h-12">
              {[
                { s: tx.features.graph, c: "#a78bfa", l: "G" },
                { s: tx.features.behavioral, c: "#38bdf8", l: "B" },
                { s: tx.features.device, c: "#22d3ee", l: "D" },
                { s: tx.features.deadAccount, c: "#f59e0b", l: "A" },
                { s: tx.features.velocity, c: "#ef4444", l: "V" },
              ].map((f) => (
                <div key={f.l} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-t" style={{ height: `${f.s * 0.48}px`, background: f.c, minHeight: 2 }} />
                  <span className="text-[8px] text-[#64748b]">{f.l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Graph Quant Quick Stats */}
          <div className="bg-[#0f172a] rounded-xl border border-slate-800 p-5">
            <h3 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">Graph-Augmented Metrics</h3>
            <div className="grid grid-cols-2 gap-3">
              <QuickStat label="Reachability" value={reachScore.toFixed(2)} color={reachScore > 3 ? "#ef4444" : "#38bdf8"} />
              <QuickStat label="Circularity" value={`${(circIdx * 100).toFixed(0)}%`} color={circIdx > 0.5 ? "#ef4444" : "#a78bfa"} />
              <QuickStat label="Path Velocity" value={`${netPathMin.toFixed(0)}min`} color={isRelayPattern ? "#ef4444" : "#22d3ee"} />
              <QuickStat label="Betweenness" value={(subgraph?.betweennessCentrality ?? 0).toFixed(3)} color="#f59e0b" />
              <QuickStat label="Geo-IP Conv" value={`${((subgraph?.geoIpConvergence ?? 0) * 100).toFixed(0)}%`} color="#34d399" />
              <QuickStat label="Identity Density" value={`${(subgraph?.identityDensity ?? 1).toFixed(1)} u/d`} color="#f472b6" />
            </div>
            {isRelayPattern && (
              <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-[10px] font-mono text-red-400 flex items-center gap-2">
                <Timer size={12} /> ⚡ RELAY PATTERN DETECTED — &lt;15min L1→L3
              </div>
            )}
            {subgraph?.cycleDetected && (
              <div className="mt-2 bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-[10px] font-mono text-red-400 flex items-center gap-2">
                <RefreshCcw size={12} /> CYCLE DETECTED — {subgraph?.cycleNodes?.length ?? 0} nodes in loop
              </div>
            )}
          </div>
        </div>

        {/* ═══ ROW 2: 3-Level Subgraph + Geodesic Map ═══ */}
        <div className="grid grid-cols-2 gap-4">
          {/* Subgraph */}
          <div className="bg-[#0f172a] rounded-xl border border-slate-800 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network size={14} className="text-sky-400" />
                <span className="text-xs font-semibold text-[#f1f5f9] uppercase tracking-wider">3-Level Transaction Subgraph</span>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-mono text-[#64748b]">
                <span>{subgraph?.nodes?.length ?? 0} nodes</span>
                <span>{subgraph?.edges?.length ?? 0} edges</span>
                <span className="text-sky-400/60">Click node • Right-click for menu</span>
              </div>
            </div>
            <div className="p-2 relative" style={{ height: 340 }}>
              <svg ref={graphRef} className="w-full h-full" />
              {/* Legend */}
              <div className="absolute bottom-3 left-3 flex items-center gap-3 text-[9px] font-mono text-[#64748b]">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#38bdf8]" /> User</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#f59e0b]" /> Mule</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#ef4444]" /> Aggregator</span>
              </div>
              {/* Selected node indicator */}
              {selectedNode && (
                <div className="absolute top-3 right-3 bg-[#020617]/90 border border-slate-700 rounded-lg px-3 py-1.5 text-[10px] font-mono text-[#f1f5f9] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: selectedNode.type === "aggregator" ? "#ef4444" : selectedNode.type === "mule" ? "#f59e0b" : "#38bdf8" }} />
                  {selectedNode.name} — L{selectedNode.level}
                  <button onClick={() => { setSelectedNode(null); setShowNodeDrawer(false); }} className="text-[#64748b] hover:text-[#f1f5f9]"><X size={10} /></button>
                </div>
              )}
            </div>

            {/* ── Node Transaction Drawer ── */}
            {showNodeDrawer && selectedNode && nodeTransactions.length > 0 && (
              <div className="border-t border-slate-800 bg-[#020617]">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/50">
                  <div className="flex items-center gap-2">
                    <Users size={12} className="text-sky-400" />
                    <span className="text-xs font-semibold text-[#f1f5f9]">
                      Transactions of <span className={selectedNode.type === "aggregator" ? "text-red-400" : selectedNode.type === "mule" ? "text-amber-400" : "text-sky-400"}>{selectedNode.name}</span>
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      selectedNode.type === "aggregator" ? "bg-red-500/15 text-red-400 border border-red-500/30"
                      : selectedNode.type === "mule" ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                      : "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                    }`}>{selectedNode.type.toUpperCase()} L{selectedNode.level}</span>
                  </div>
                  <button onClick={() => setShowNodeDrawer(false)} className="text-[#64748b] hover:text-[#f1f5f9]"><X size={14} /></button>
                </div>
                <div className="max-h-[240px] overflow-y-auto divide-y divide-slate-800/50">
                  {nodeTransactions.map((ntx) => (
                    <div
                      key={ntx.id}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-[#0f172a]/60 transition-colors cursor-pointer group"
                      onClick={() => handleNodeTxSidebar(ntx)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setNodeContextMenu({ x: e.clientX, y: e.clientY, node: selectedNode });
                      }}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${ntx.riskScore >= 80 ? "animate-pulse" : ""}`}
                        style={{ backgroundColor: getRiskColor(ntx.riskScore) }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="font-mono text-[#94a3b8] truncate">{(ntx.senderUPI || "unknown").split("@")[0].slice(0, 8)}</span>
                          <span className="text-[#475569]">→</span>
                          <span className="font-mono text-[#94a3b8] truncate">{(ntx.receiverUPI || "unknown").split("@")[0].slice(0, 8)}</span>
                        </div>
                        <div className="text-[9px] text-[#475569]">{ntx.city || "—"} · {ntx.latencyMs ?? 0}ms</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[11px] font-mono font-semibold" style={{ color: getRiskColor(ntx.riskScore) }}>{formatINR(ntx.amount)}</div>
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${getRiskBadgeClass(ntx.riskScore)}`}>{ntx.riskScore}</span>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); handleNodeTxSidebar(ntx); }}
                        className="opacity-0 group-hover:opacity-100 text-[9px] font-semibold px-2 py-1 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30 hover:bg-violet-500/25 transition-all shrink-0">
                        <Eye size={10} className="inline mr-0.5" />Analyze
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Geodesic Map */}
          <div>
            <GeodesicArcMap evidence={tx.geoEvidence} />
          </div>
        </div>

        {/* ═══ ROW 3: Behavioral Radar + Triggered Rules ═══ */}
        <div className="grid grid-cols-2 gap-4">
          {/* 8-axis Radar */}
          <div className="bg-[#0f172a] rounded-xl border border-slate-800 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Cpu size={14} className="text-violet-400" />
                <span className="text-xs font-semibold text-[#f1f5f9] uppercase tracking-wider">Behavioral Fingerprint</span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                isHighRisk ? "bg-red-500/15 text-red-400 border border-red-500/30"
                : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
              }`}>{isHighRisk ? "MULE PROFILE" : "NORMAL"}</span>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="68%">
                <PolarGrid stroke="#1e293b" strokeDasharray="3 3" />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 9, fill: "#94a3b8" }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 7, fill: "#475569" }} axisLine={false} />
                <Radar name="Normal" dataKey="normal" stroke="#10b981" fill="#10b981" fillOpacity={0.06} strokeWidth={1.5} strokeDasharray="4 3" />
                <Radar name="Current" dataKey="current" stroke={isHighRisk ? "#ef4444" : "#38bdf8"} fill={isHighRisk ? "#ef4444" : "#38bdf8"} fillOpacity={0.12} strokeWidth={2} />
                <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", fontSize: "11px", color: "#f1f5f9" }} />
                <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "4px" }} iconType="line" />
              </RadarChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-4 gap-1.5 mt-2">
              {radarData.map((d) => {
                const dev = d.current - d.normal;
                const devColor = Math.abs(dev) > 25 ? "#ef4444" : Math.abs(dev) > 10 ? "#f59e0b" : "#10b981";
                return (
                  <div key={d.axis} className="bg-[#020617] rounded-lg p-1.5 text-center">
                    <div className="text-[8px] text-[#64748b] truncate">{d.axis}</div>
                    <div className="text-[11px] font-mono font-semibold" style={{ color: devColor }}>{d.current}</div>
                    <div className="text-[8px] font-mono text-[#475569]">{dev >= 0 ? "+" : ""}{dev}Δ</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between px-3 py-2 rounded-lg bg-[#020617] border border-[#1e293b]">
              <span className="text-[10px] text-[#64748b] font-mono">Composite Deviation</span>
              <span className={`text-sm font-bold font-mono ${avgDeviation > 30 ? "text-[#ef4444]" : avgDeviation > 15 ? "text-[#f59e0b]" : "text-[#10b981]"}`}>
                {avgDeviation.toFixed(1)}σ
              </span>
            </div>
          </div>

          {/* Triggered Rules + Geo Calculus */}
          <div className="space-y-4">
            {/* Triggered Rules */}
            <div className="bg-[#0f172a] rounded-xl border border-slate-800 p-5">
              <h3 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">Triggered Rules</h3>
              {tx.triggeredRules.length === 0 ? (
                <p className="text-xs text-[#475569]">No rules triggered</p>
              ) : (
                <div className="space-y-2">
                  {tx.triggeredRules.map((rule, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-[#020617] border border-[#1e293b]">
                      <div className="mt-0.5">
                        {rule.severity === "CRITICAL" ? <AlertTriangle size={14} className="text-red-400" />
                         : rule.severity === "WARNING" ? <AlertTriangle size={14} className="text-amber-400" />
                         : <Activity size={14} className="text-blue-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            rule.severity === "CRITICAL" ? "bg-red-500/15 text-red-400"
                            : rule.severity === "WARNING" ? "bg-amber-500/15 text-amber-400"
                            : "bg-blue-500/15 text-blue-400"
                          }`}>{rule.severity}</span>
                          <span className="text-xs font-semibold text-[#f1f5f9]">{rule.rule}</span>
                        </div>
                        <p className="text-xs text-[#94a3b8] mt-1">{rule.detail}</p>
                        <p className="text-xs font-mono text-[#ef4444] mt-0.5">Score: +{rule.scoreImpact}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Geo-Spatial Quick */}
            <div className="bg-[#0f172a] rounded-xl border border-slate-800 p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Globe size={14} className="text-sky-400" />
                  <span className="text-xs font-semibold text-[#f1f5f9] uppercase tracking-wider">Geo-Spatial Calculus</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                  style={{ backgroundColor: riskProb.color + "20", color: riskProb.color, border: `1px solid ${riskProb.color}40` }}>
                  {riskProb.tier}
                </span>
              </div>
              <div className="font-mono text-[11px] text-[#94a3b8] space-y-1.5 bg-[#020617] rounded-lg p-3 border border-[#1e293b]">
                <div>d = R·c = <span className="text-[#f59e0b] font-semibold">{haversineDist.toFixed(1)} km</span></div>
                <div>v = d/Δt = <span className="text-lg font-bold" style={{ color: riskProb.color }}>{Math.round(velocity)} km/h</span></div>
                <div className="text-[#475569]">{geo.deviceGeo.city} → {geo.ipGeo.city} in {geo.timeDeltaMin}min</div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ ROW 4: Full Probability Matrix ═══ */}
        <ProbabilityMatrix transaction={tx} />

        {/* ═══ ROW 5: Feature Radar + Hop Velocity Tiers ═══ */}
        <div className="grid grid-cols-3 gap-4">
          {/* Feature Radar */}
          <div className="bg-[#0f172a] rounded-xl border border-slate-800 p-5">
            <h3 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">Feature Contribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={[
                { feature: "Graph", value: tx.features.graph },
                { feature: "Behavioral", value: tx.features.behavioral },
                { feature: "Device", value: tx.features.device },
                { feature: "Dead Acct", value: tx.features.deadAccount },
                { feature: "Velocity", value: tx.features.velocity },
              ]} cx="50%" cy="50%" outerRadius="68%">
                <PolarGrid stroke="#1e293b" />
                <PolarAngleAxis dataKey="feature" tick={{ fontSize: 9, fill: "#94a3b8" }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 7, fill: "#475569" }} axisLine={false} />
                <Radar name="Score" dataKey="value" stroke={riskColor} fill={riskColor} fillOpacity={0.2} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Hop-Adjusted Velocity */}
          <div className="bg-[#0f172a] rounded-xl border border-slate-800 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Route size={14} className="text-violet-400" />
              <span className="text-xs font-semibold text-[#f1f5f9] uppercase tracking-wider">Hop-Adjusted Velocity</span>
            </div>
            <div className="font-mono text-[11px] text-[#94a3b8] space-y-1.5 mb-4">
              <div>HAV = Avg(₹/min) L1→L3</div>
              <div>HAV = <span className="text-lg font-bold text-[#22d3ee]">₹{hopVelocity.toLocaleString()}/min</span></div>
              <div>Network Path = <span className={`font-bold ${isRelayPattern ? "text-[#ef4444]" : "text-[#10b981]"}`}>
                {netPathMin.toFixed(1)}min
              </span></div>
            </div>
            <div className="space-y-1.5">
              {[
                { label: "> 30 min", color: "#10b981", scenario: "Normal", active: netPathMin > 30 },
                { label: "15–30 min", color: "#f59e0b", scenario: "Fast chain", active: netPathMin >= 15 && netPathMin <= 30 },
                { label: "< 15 min", color: "#ef4444", scenario: "Relay mule", active: netPathMin < 15 },
              ].map((t) => (
                <div key={t.label} className={`flex items-center justify-between px-2.5 py-2 rounded-lg border text-[10px] font-mono ${
                  t.active ? "border-sky-500/30 bg-[#020617]" : "border-[#1e293b] bg-[#0f172a] opacity-40"
                }`}>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className="text-[#94a3b8]">{t.label}</span>
                  </div>
                  <span className="text-[#64748b]">{t.scenario}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Circularity + Reachability */}
          <div className="bg-[#0f172a] rounded-xl border border-slate-800 p-5">
            <div className="flex items-center gap-2 mb-3">
              <RefreshCcw size={14} className="text-violet-400" />
              <span className="text-xs font-semibold text-[#f1f5f9] uppercase tracking-wider">Wash Trade Analysis</span>
            </div>
            <div className="space-y-4">
              <div className="bg-[#020617] rounded-lg p-3 border border-[#1e293b]">
                <div className="text-[9px] text-[#64748b] uppercase font-semibold mb-1">Circularity Index</div>
                <div className="text-2xl font-bold font-mono" style={{ color: circIdx > 0.5 ? "#ef4444" : "#a78bfa" }}>
                  {(circIdx * 100).toFixed(1)}%
                </div>
                <div className="h-1.5 bg-[#0f172a] rounded-full mt-2 overflow-hidden">
                  <div className="h-full rounded-full" style={{
                    width: `${circIdx * 100}%`,
                    background: circIdx > 0.5 ? "#ef4444" : "#a78bfa",
                  }} />
                </div>
              </div>
              <div className="bg-[#020617] rounded-lg p-3 border border-[#1e293b]">
                <div className="text-[9px] text-[#64748b] uppercase font-semibold mb-1">Reachability Score</div>
                <div className="text-2xl font-bold font-mono" style={{ color: reachScore > 3 ? "#ef4444" : "#38bdf8" }}>
                  {reachScore.toFixed(2)}
                </div>
                <div className="h-1.5 bg-[#0f172a] rounded-full mt-2 overflow-hidden">
                  <div className="h-full rounded-full" style={{
                    width: `${Math.min(100, reachScore * 20)}%`,
                    background: reachScore > 3 ? "#ef4444" : "#38bdf8",
                  }} />
                </div>
              </div>
              {subgraph?.cycleDetected && (
                <div className="bg-red-500/10 rounded-lg p-2 border border-red-500/20 text-[10px] font-mono text-red-400">
                  Cycle path: {(subgraph?.cycleNodes ?? []).slice(0, 3).map((n) => n.slice(0, 8)).join(" → ")} → …
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ═══ ROW 6: AI-Powered Analysis ═══ */}
        <div className="bg-gradient-to-br from-[#0f172a] via-[#0f172a] to-[#1a0a2e] rounded-xl border border-violet-500/20 overflow-hidden">
          <div className="px-5 py-3 border-b border-violet-500/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                <Sparkles size={12} className="text-white" />
              </div>
              <span className="text-xs font-semibold text-[#f1f5f9] uppercase tracking-wider">AI-Powered Analysis</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30 font-mono">NON-TECHNICAL</span>
            </div>
            {aiAnalysis && (
              <button onClick={() => { setAiAnalysis(null); setAiError(null); }}
                className="text-[10px] font-mono text-[#64748b] hover:text-[#f1f5f9] transition-colors">
                Reset
              </button>
            )}
          </div>

          {!aiAnalysis && !aiLoading ? (
            <div className="p-8 flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/30 flex items-center justify-center">
                <Brain size={28} className="text-violet-400" />
              </div>
              <div className="text-center max-w-md">
                <h3 className="text-sm font-semibold text-[#f1f5f9] mb-1">Understand This Transaction in Plain English</h3>
                <p className="text-xs text-[#64748b]">Our AI will analyze all risk signals, network patterns, and behavioral anomalies to give you a clear, non-technical summary of what's happening and what you should do.</p>
              </div>
              <button
                onClick={requestAIAnalysis}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-semibold hover:from-violet-500 hover:to-fuchsia-500 transition-all shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40"
              >
                <Sparkles size={16} />
                Analyze with AI
              </button>
            </div>
          ) : aiLoading ? (
            <div className="p-12 flex flex-col items-center justify-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-xl border-2 border-violet-500/30 border-t-violet-400 animate-spin" />
                <Brain size={18} className="absolute inset-0 m-auto text-violet-400" />
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold text-[#f1f5f9]">Analyzing transaction patterns...</p>
                <p className="text-[10px] text-[#64748b] mt-1">Examining {subgraph?.nodes?.length ?? 0} nodes, {tx.triggeredRules.length} rules, and behavioral signatures</p>
              </div>
            </div>
          ) : aiAnalysis ? (
            <div className="p-5 space-y-4">
              {aiError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 font-mono">
                  <AlertTriangle size={12} /> Server unavailable — showing client-side analysis
                </div>
              )}

              {/* Verdict Banner */}
              <div className={`rounded-xl p-4 border ${
                aiAnalysis.riskVerdict.startsWith("HIGH") ? "bg-red-500/10 border-red-500/20" :
                aiAnalysis.riskVerdict.startsWith("ELEVATED") ? "bg-amber-500/10 border-amber-500/20" :
                aiAnalysis.riskVerdict.startsWith("MODERATE") ? "bg-yellow-500/10 border-yellow-500/20" :
                "bg-emerald-500/10 border-emerald-500/20"
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={16} className={
                    aiAnalysis.riskVerdict.startsWith("HIGH") ? "text-red-400" :
                    aiAnalysis.riskVerdict.startsWith("ELEVATED") ? "text-amber-400" :
                    "text-emerald-400"
                  } />
                  <span className={`text-sm font-bold ${
                    aiAnalysis.riskVerdict.startsWith("HIGH") ? "text-red-400" :
                    aiAnalysis.riskVerdict.startsWith("ELEVATED") ? "text-amber-400" :
                    "text-emerald-400"
                  }`}>{aiAnalysis.riskVerdict}</span>
                </div>
                <p className="text-xs text-[#e2e8f0] leading-relaxed">{aiAnalysis.summary}</p>
              </div>

              {/* Issues */}
              {aiAnalysis.issues.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-[#f1f5f9] mb-2 flex items-center gap-2">
                    <AlertTriangle size={12} className="text-red-400" />
                    Issues Found ({aiAnalysis.issues.length})
                  </h4>
                  <div className="space-y-2">
                    {aiAnalysis.issues.map((issue, i) => (
                      <div key={i} className={`rounded-lg p-3 border ${
                        issue.severity === "critical" ? "bg-red-500/5 border-red-500/20" :
                        issue.severity === "warning" ? "bg-amber-500/5 border-amber-500/20" :
                        "bg-blue-500/5 border-blue-500/20"
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                            issue.severity === "critical" ? "bg-red-500/15 text-red-400 border border-red-500/30" :
                            issue.severity === "warning" ? "bg-amber-500/15 text-amber-400 border border-amber-500/30" :
                            "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                          }`}>{issue.severity}</span>
                          <span className="text-xs font-semibold text-[#f1f5f9]">{issue.title}</span>
                        </div>
                        <p className="text-[11px] text-[#94a3b8] leading-relaxed">{issue.explanation}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Possibilities */}
              {aiAnalysis.possibilities.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-[#f1f5f9] mb-2 flex items-center gap-2">
                    <Workflow size={12} className="text-sky-400" />
                    What Could Be Happening
                  </h4>
                  <div className="space-y-1.5">
                    {aiAnalysis.possibilities.map((p, i) => (
                      <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#020617] border border-[#1e293b]">
                        <ChevronRight size={12} className="text-sky-400 mt-0.5 shrink-0" />
                        <p className="text-[11px] text-[#94a3b8]">{p}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendation */}
              <div className="rounded-xl p-4 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 border border-violet-500/20">
                <h4 className="text-xs font-semibold text-[#f1f5f9] mb-1.5 flex items-center gap-2">
                  <Sparkles size={12} className="text-violet-400" />
                  Recommended Action
                </h4>
                <p className="text-xs text-[#e2e8f0] leading-relaxed">{aiAnalysis.recommendation}</p>
              </div>

              {/* Reanalyze button */}
              <div className="flex justify-center pt-2">
                <button onClick={requestAIAnalysis}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-semibold bg-[#0f172a] border border-slate-700 text-[#94a3b8] hover:text-[#f1f5f9] hover:border-slate-600 transition-all">
                  <RefreshCcw size={10} /> Re-analyze
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Node Context Menu (portal-style fixed overlay) ── */}
      {nodeContextMenu && (
        <div
          className="fixed z-[100] min-w-[200px] bg-[#0f172a] border border-slate-700 rounded-xl shadow-2xl shadow-black/60 py-1 overflow-hidden"
          style={{ left: nodeContextMenu.x, top: nodeContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: nodeContextMenu.node.type === "aggregator" ? "#ef4444" : nodeContextMenu.node.type === "mule" ? "#f59e0b" : "#38bdf8" }} />
              <span className="text-xs font-semibold text-[#f1f5f9]">{nodeContextMenu.node.name}</span>
              <span className="text-[9px] font-mono text-[#64748b]">L{nodeContextMenu.node.level}</span>
            </div>
            <div className="text-[9px] font-mono text-[#475569] mt-0.5">{nodeContextMenu.node.upi}</div>
          </div>
          <button
            onClick={() => { handleNodeClick(nodeContextMenu.node); setNodeContextMenu(null); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#94a3b8] hover:bg-[#1e293b] hover:text-[#f1f5f9] transition-colors"
          >
            <Eye size={12} className="text-sky-400" /> View All Transactions
          </button>
          <button
            onClick={async () => {
              try {
                const ntxs = await fetchNodeTransactions(nodeContextMenu.node.id, 1);
                if (ntxs.length > 0) handleNodeTxSidebar(ntxs[0]);
              } catch { /* ignore */ }
              setNodeContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#94a3b8] hover:bg-[#1e293b] hover:text-[#f1f5f9] transition-colors"
          >
            <Crosshair size={12} className="text-violet-400" /> Sidebar Analysis
          </button>
          <div className="border-t border-slate-800 mx-2" />
          <button
            onClick={() => {
              setNodeContextMenu(null);
              navigator.clipboard?.writeText(nodeContextMenu.node.upi);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#94a3b8] hover:bg-[#1e293b] hover:text-[#f1f5f9] transition-colors"
          >
            <Copy size={12} className="text-[#64748b]" /> Copy UPI Address
          </button>
          <div className="px-3 py-2 bg-[#020617]/50">
            <div className="flex items-center justify-between text-[9px] font-mono text-[#475569]">
              <span>Risk: <span style={{ color: getRiskColor(nodeContextMenu.node.riskScore) }}>{nodeContextMenu.node.riskScore}</span></span>
              <span>Fan: {nodeContextMenu.node.fanIn}↓ {nodeContextMenu.node.fanOut}↑</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Node Sidebar Analysis ── */}
      {showNodeSidebar && nodeSidebarTx && (
        <div className="fixed inset-0 z-[90] flex">
          <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={() => setShowNodeSidebar(false)} />
          <ResizableSidebar defaultWidth={420}>
            <div className="h-full bg-[#0f172a] border-l border-slate-800 flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-2">
                  <Crosshair size={14} className="text-violet-400" />
                  <span className="text-xs font-semibold text-[#f1f5f9]">Node Transaction Analysis</span>
                </div>
                <button onClick={() => setShowNodeSidebar(false)} className="text-[#64748b] hover:text-[#f1f5f9]"><X size={14} /></button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <IntelligencePanel transaction={nodeSidebarTx} />
              </div>
            </div>
          </ResizableSidebar>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────

function InfoRow({ icon, label, value, sub, mono, highlight }: {
  icon: ReactNode; label: string; value: string; sub?: string; mono?: boolean; highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[#475569] mt-0.5">{icon}</span>
      <div className="min-w-0">
        <div className="text-[9px] text-[#475569] uppercase">{label}</div>
        <div className={`text-xs truncate ${mono ? "font-mono" : ""} ${highlight ? "text-[#f59e0b] font-semibold" : "text-[#f1f5f9]"}`}>
          {value}
        </div>
        {sub && <div className="text-[10px] text-[#475569] font-mono truncate">{sub}</div>}
      </div>
    </div>
  );
}

function QuickStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#020617] rounded-lg p-2 text-center border border-[#1e293b]">
      <div className="text-[8px] text-[#64748b] uppercase">{label}</div>
      <div className="text-sm font-bold font-mono" style={{ color }}>{value}</div>
    </div>
  );
}

type ReactNode = React.ReactNode;
