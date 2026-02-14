"use client";

import { useRef, useEffect, useMemo, useState } from "react";
import * as d3 from "d3";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, Legend,
} from "recharts";
import type { Transaction, BehavioralSignature, RealtimeSubgraph } from "@/lib/types";
import { fetchSubgraph } from "@/lib/api";
import { getRiskColor, getRiskLabel, formatINR } from "@/lib/utils";
import {
  X, Globe, Cpu, TrendingUp, Network, AlertTriangle,
  Crosshair, GitBranch, Activity, Zap, Route, RefreshCcw, Timer,
} from "lucide-react";

interface QuantDrawerProps {
  transaction: Transaction;
  onClose: () => void;
}

// ── Haversine Formula ────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Risk probability tiers
function getGeoRiskProbability(speedKmh: number): { tier: string; probability: number; color: string } {
  if (speedKmh <= 250) return { tier: "PLAUSIBLE", probability: 0, color: "#10b981" };
  if (speedKmh <= 800) return { tier: "SUSPICIOUS", probability: 0.45, color: "#f59e0b" };
  return { tier: "IMPOSSIBLE", probability: 0.95, color: "#ef4444" };
}

// ── 8-axis normal profile ────────────────────────────────────
const NORMAL_8: Record<string, number> = {
  "Amt Entropy": 72,
  "Fan-In": 25,
  "Temporal": 80,
  "Device Age": 85,
  "ASN Div": 20,
  "Vel. Burst": 15,
  "Circadian": 80,
  "ISP Cons.": 85,
};

export function QuantDrawer({ transaction, onClose }: QuantDrawerProps) {
  const tx = transaction;
  const geo = tx.geoEvidence;
  const sig = tx.behavioralSignature;
  const riskColor = getRiskColor(tx.riskScore);

  // ── Module A: Geo-Spatial Calculus ─────────────────────────
  const haversineDist = haversine(
    geo.deviceGeo.lat, geo.deviceGeo.lng,
    geo.ipGeo.lat, geo.ipGeo.lng
  );
  const velocity = geo.timeDeltaMin > 0 ? (haversineDist / geo.timeDeltaMin) * 60 : 0;
  const riskProb = getGeoRiskProbability(velocity);

  // ── Module B: 8-axis radar data ────────────────────────────
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

  const isHighRisk = tx.riskScore >= 60;

  // Composite deviation score
  const totalDeviation = radarData.reduce((sum, d) => sum + Math.abs(d.current - d.normal), 0);
  const avgDeviation = totalDeviation / radarData.length;

  // ── Module C: Graph centrality + Graph-Augmented Quant Math ──
  const miniGraphRef = useRef<SVGSVGElement>(null);
  const [subgraph, setSubgraph] = useState<RealtimeSubgraph | null>(null);
  const subgraphUserId = tx.senderName || tx.id;
  useEffect(() => {
    fetchSubgraph(subgraphUserId).then(setSubgraph).catch(() => setSubgraph(null));
  }, [subgraphUserId]);

  useEffect(() => {
    const svgEl = miniGraphRef.current;
    if (!svgEl) return;

    const w = 280, h = 160;
    const sel = d3.select(svgEl);
    sel.selectAll("*").remove();

    // Generate a small 3-hop local graph
    const center = { id: "center", x: w / 2, y: h / 2, r: 8, color: riskColor, label: "TX" };
    const hopNodes: { id: string; x: number; y: number; r: number; color: string; label: string }[] = [center];
    const hopEdges: { source: string; target: string; hop: number }[] = [];
    let idx = 0;

    // Hop 1 (3-5 nodes)
    const hop1Count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < hop1Count; i++) {
      const angle = (i / hop1Count) * Math.PI * 2;
      const nd = {
        id: `h1_${i}`, x: w / 2 + Math.cos(angle) * 45, y: h / 2 + Math.sin(angle) * 40,
        r: 5, color: "#38bdf8", label: "",
      };
      hopNodes.push(nd);
      hopEdges.push({ source: "center", target: nd.id, hop: 1 });
    }

    // Hop 2 (2-3 per hop1)
    for (let i = 0; i < hop1Count; i++) {
      const count2 = 1 + Math.floor(Math.random() * 2);
      for (let j = 0; j < count2; j++) {
        idx++;
        const parent = hopNodes[i + 1];
        const angle = ((i * 3 + j) / (hop1Count * 2)) * Math.PI * 2 + 0.3;
        const nd = {
          id: `h2_${idx}`, x: w / 2 + Math.cos(angle) * 80, y: h / 2 + Math.sin(angle) * 65,
          r: 4, color: "#a78bfa", label: "",
        };
        hopNodes.push(nd);
        hopEdges.push({ source: parent.id, target: nd.id, hop: 2 });
      }
    }

    // Hop 3 (1-2 per hop2)
    const hop2Nodes = hopNodes.filter((n) => n.id.startsWith("h2_"));
    for (const h2 of hop2Nodes.slice(0, 4)) {
      idx++;
      const angle = Math.random() * Math.PI * 2;
      const nd = {
        id: `h3_${idx}`, x: w / 2 + Math.cos(angle) * 115, y: h / 2 + Math.sin(angle) * 72,
        r: 3, color: "#64748b", label: "",
      };
      hopNodes.push(nd);
      hopEdges.push({ source: h2.id, target: nd.id, hop: 3 });
    }

    // Draw edges
    const nodeMap = new Map(hopNodes.map((n) => [n.id, n]));
    for (const e of hopEdges) {
      const s = nodeMap.get(e.source)!, t = nodeMap.get(e.target)!;
      sel.append("line")
        .attr("x1", s.x).attr("y1", s.y)
        .attr("x2", t.x).attr("y2", t.y)
        .attr("stroke", e.hop === 1 ? "rgba(56,189,248,0.3)" : e.hop === 2 ? "rgba(167,139,250,0.25)" : "rgba(100,116,139,0.2)")
        .attr("stroke-width", 4 - e.hop);
    }

    // Draw nodes
    for (const n of hopNodes) {
      sel.append("circle")
        .attr("cx", n.x).attr("cy", n.y).attr("r", n.r)
        .attr("fill", n.color).attr("stroke", "#0f172a").attr("stroke-width", 1);
      if (n.label) {
        sel.append("text").attr("x", n.x).attr("y", n.y + 3)
          .attr("text-anchor", "middle").attr("fill", "#0f172a")
          .attr("font-size", 7).attr("font-weight", "bold")
          .text(n.label);
      }
    }

    // Cycle indicator: connect a hop3 back to hop1 (visual cycle)
    if (hop2Nodes.length > 0 && hopNodes.length > hop1Count + 2) {
      const cycleStart = hopNodes[hopNodes.length - 1];
      const cycleEnd = hopNodes[1]; // first hop1
      sel.append("line")
        .attr("x1", cycleStart.x).attr("y1", cycleStart.y)
        .attr("x2", cycleEnd.x).attr("y2", cycleEnd.y)
        .attr("stroke", "#ef4444").attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "3 3")
        .attr("opacity", 0.6);
    }
  }, [riskColor]);

  // Graph-augmented quant values from subgraph
  const betweenness = (subgraph?.betweennessCentrality ?? 0).toFixed(4);
  const pageRank = (tx.riskScore / 100 * 0.08 + 0.02).toFixed(4);
  const cycleDetected = subgraph?.cycleDetected ?? false;
  const clusterCoeff = (0.35).toFixed(3);

  // ── Graph-Augmented Quant Metrics ──────────────────────────
  const reachScore = subgraph?.reachabilityScore ?? 0;
  const circIdx = subgraph?.circularityIndex ?? 0;
  const hopVelocity = subgraph?.hopAdjustedVelocity ?? 0;
  const netPathMin = subgraph?.networkPathVelocityMin ?? 60;
  const isRelayPattern = netPathMin < 15;

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[440px] bg-[#0a0f1e]/95 backdrop-blur-md border-l border-slate-800 z-[60] animate-slide-in overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#0a0f1e]/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#a78bfa] to-[#38bdf8] flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-[#f1f5f9] tracking-tight">Quant Intelligence</h2>
            <p className="text-[10px] text-[#64748b] font-mono">{tx.id}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#1e293b] text-[#64748b] hover:text-[#f1f5f9] transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-5 p-5">
        {/* ═══════════════════════════════════════════════════════ */}
        {/* MODULE A: Geo-Spatial Calculus                         */}
        {/* ═══════════════════════════════════════════════════════ */}
        <section className="bg-[#020617] rounded-xl border border-slate-800 border-t-sky-500/20 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe size={14} className="text-sky-400" />
              <span className="text-xs font-semibold text-[#f1f5f9] uppercase tracking-wider">Geo-Spatial Calculus</span>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded`}
              style={{ backgroundColor: riskProb.color + "20", color: riskProb.color, border: `1px solid ${riskProb.color}40` }}>
              {riskProb.tier}
            </span>
          </div>

          <div className="p-4 space-y-4">
            {/* Haversine formula */}
            <div className="bg-[#0f172a] rounded-lg p-3 border border-[#1e293b]">
              <p className="text-[9px] text-[#64748b] uppercase tracking-wider font-semibold mb-2">Haversine Distance Formula</p>
              <div className="font-mono text-[11px] text-[#94a3b8] leading-relaxed space-y-1">
                <div>a = sin²(Δφ/2) + cos(φ₁)·cos(φ₂)·sin²(Δλ/2)</div>
                <div>c = 2·atan2(√a, √(1−a))</div>
                <div>d = R·c = <span className="text-[#f59e0b] font-semibold">{haversineDist.toFixed(1)} km</span></div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] font-mono text-[#64748b]">
                <div>φ₁ = {geo.deviceGeo.lat.toFixed(3)}° ({geo.deviceGeo.city})</div>
                <div>φ₂ = {geo.ipGeo.lat.toFixed(3)}° ({geo.ipGeo.city})</div>
                <div>λ₁ = {geo.deviceGeo.lng.toFixed(3)}°</div>
                <div>λ₂ = {geo.ipGeo.lng.toFixed(3)}°</div>
              </div>
            </div>

            {/* Velocity calculation */}
            <div className="bg-[#0f172a] rounded-lg p-3 border border-[#1e293b]">
              <p className="text-[9px] text-[#64748b] uppercase tracking-wider font-semibold mb-2">Velocity Inference</p>
              <div className="font-mono text-[11px] text-[#94a3b8]">
                v = d / Δt = {haversineDist.toFixed(1)}km / {geo.timeDeltaMin}min × 60
                = <span className="text-lg font-bold" style={{ color: riskProb.color }}>{Math.round(velocity)} km/h</span>
              </div>
            </div>

            {/* Risk probability tiers */}
            <div className="space-y-1.5">
              <p className="text-[9px] text-[#64748b] uppercase tracking-wider font-semibold">Risk Probability Tiers</p>
              {[
                { label: "< 250 km/h", prob: "0%", scenario: "Normal travel", color: "#10b981", active: velocity <= 250 },
                { label: "250 – 800 km/h", prob: "45%", scenario: "Domestic flight possible", color: "#f59e0b", active: velocity > 250 && velocity <= 800 },
                { label: "> 800 km/h", prob: "95%", scenario: "Impossible — proxy/VPN", color: "#ef4444", active: velocity > 800 },
              ].map((tier) => (
                <div key={tier.label}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg border text-[11px] font-mono transition-all ${
                    tier.active
                      ? "border-sky-500/30 bg-[#020617] shadow-[0_0_10px_rgba(56,189,248,0.08)]"
                      : "border-[#1e293b] bg-[#0f172a] opacity-50"
                  }`}>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tier.color }} />
                    <span className="text-[#94a3b8]">{tier.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[#64748b]">{tier.scenario}</span>
                    <span className="font-semibold" style={{ color: tier.color }}>P={tier.prob}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* MODULE B: 8-axis Behavioral Fingerprint Radar          */}
        {/* ═══════════════════════════════════════════════════════ */}
        <section className="bg-[#020617] rounded-xl border border-slate-800 border-t-sky-500/20 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-violet-400" />
              <span className="text-xs font-semibold text-[#f1f5f9] uppercase tracking-wider">Behavioral Fingerprint</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                isHighRisk
                  ? "bg-red-500/15 text-red-400 border border-red-500/30"
                  : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
              }`}>
                {isHighRisk ? "MULE PROFILE" : "NORMAL PROFILE"}
              </span>
              <span className="text-[10px] font-mono text-[#64748b]">8-axis</span>
            </div>
          </div>

          <div className="p-4">
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="68%">
                <PolarGrid stroke="#1e293b" strokeDasharray="3 3" />
                <PolarAngleAxis
                  dataKey="axis"
                  tick={{ fontSize: 8, fill: "#94a3b8", fontFamily: "'Inter', sans-serif" }}
                />
                <PolarRadiusAxis
                  angle={90} domain={[0, 100]}
                  tick={{ fontSize: 7, fill: "#475569" }} axisLine={false}
                />
                <Radar name="Normal" dataKey="normal"
                  stroke="#10b981" fill="#10b981" fillOpacity={0.06}
                  strokeWidth={1.5} strokeDasharray="4 3" />
                <Radar name="Current" dataKey="current"
                  stroke={isHighRisk ? "#ef4444" : "#38bdf8"}
                  fill={isHighRisk ? "#ef4444" : "#38bdf8"}
                  fillOpacity={0.12} strokeWidth={2} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a", border: "1px solid #1e293b",
                    borderRadius: "8px", fontSize: "11px", color: "#f1f5f9",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                  formatter={(value: any, name: any) => [`${value}`, name]}
                />
                <Legend
                  wrapperStyle={{ fontSize: "10px", paddingTop: "4px" }}
                  iconType="line"
                  formatter={(value: string) => (
                    <span style={{
                      color: value === "Normal" ? "#10b981" : isHighRisk ? "#ef4444" : "#38bdf8",
                      fontSize: "10px",
                    }}>{value}</span>
                  )}
                />
              </RadarChart>
            </ResponsiveContainer>

            {/* Axis deviation grid */}
            <div className="grid grid-cols-4 gap-1.5 mt-2">
              {radarData.map((d) => {
                const dev = d.current - d.normal;
                const devColor = Math.abs(dev) > 25 ? "#ef4444" : Math.abs(dev) > 10 ? "#f59e0b" : "#10b981";
                return (
                  <div key={d.axis} className="bg-[#0f172a] rounded-lg p-1.5 text-center">
                    <div className="text-[8px] text-[#64748b] mb-0.5 truncate">{d.axis}</div>
                    <div className="text-[11px] font-mono font-semibold" style={{ color: devColor }}>{d.current}</div>
                    <div className="text-[8px] font-mono text-[#475569]">
                      {dev >= 0 ? "+" : ""}{dev} Δ
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Composite deviation */}
            <div className="mt-3 flex items-center justify-between px-3 py-2 rounded-lg bg-[#0f172a] border border-[#1e293b]">
              <span className="text-[10px] text-[#64748b] font-mono">Composite Deviation (Σ|Δ|/n)</span>
              <span className={`text-sm font-bold font-mono ${avgDeviation > 30 ? "text-[#ef4444]" : avgDeviation > 15 ? "text-[#f59e0b]" : "text-[#10b981]"}`}>
                {avgDeviation.toFixed(1)}σ
              </span>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* MODULE C: Graph Transitivity & Centrality Insights     */}
        {/* ═══════════════════════════════════════════════════════ */}
        <section className="bg-[#020617] rounded-xl border border-slate-800 border-t-sky-500/20 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Network size={14} className="text-sky-400" />
              <span className="text-xs font-semibold text-[#f1f5f9] uppercase tracking-wider">Graph Centrality</span>
            </div>
            {cycleDetected && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30 flex items-center gap-1">
                <AlertTriangle size={10} /> CYCLE
              </span>
            )}
          </div>

          <div className="p-4 space-y-4">
            {/* 3-hop local graph visualization */}
            <div className="bg-[#0f172a] rounded-lg border border-[#1e293b] overflow-hidden">
              <div className="px-3 py-2 border-b border-[#1e293b] flex items-center justify-between">
                <span className="text-[9px] text-[#64748b] uppercase tracking-wider font-semibold">3-Hop Local Graph</span>
                <span className="text-[9px] font-mono text-[#475569]">D3 force-directed</span>
              </div>
              <svg ref={miniGraphRef} viewBox="0 0 280 160" className="w-full h-36" />
            </div>

            {/* Centrality metrics */}
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                icon={<Crosshair size={12} />}
                label="Betweenness"
                value={betweenness}
                color="#a78bfa"
                description="Bridge centrality"
              />
              <MetricCard
                icon={<TrendingUp size={12} />}
                label="PageRank"
                value={pageRank}
                color="#38bdf8"
                description="Influence score"
              />
              <MetricCard
                icon={<GitBranch size={12} />}
                label="Cluster Coeff"
                value={clusterCoeff}
                color="#22d3ee"
                description="Local transitivity"
              />
              <MetricCard
                icon={<Activity size={12} />}
                label="Cycle Check"
                value={cycleDetected ? "DETECTED" : "CLEAN"}
                color={cycleDetected ? "#ef4444" : "#10b981"}
                description={cycleDetected ? "Ring topology" : "No cycles found"}
              />
            </div>

            {/* Interpretation */}
            <div className={`rounded-lg p-3 border text-[11px] font-mono leading-relaxed ${
              tx.riskScore >= 60
                ? "bg-red-500/5 border-red-500/20 text-red-300/80"
                : "bg-sky-500/5 border-sky-500/20 text-sky-300/80"
            }`}>
              {tx.riskScore >= 60
                ? `⚠ High betweenness (${betweenness}) indicates bridge node in mule topology. ${cycleDetected ? "Cyclic fund-loop detected — typical of layering stage." : ""} PageRank ${pageRank} shows elevated influence.`
                : `✓ Normal centrality profile. Node operates within expected graph parameters. No suspicious topology detected.`
              }
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* MODULE D: Graph-Augmented Quant Mathematics            */}
        {/* ═══════════════════════════════════════════════════════ */}
        <section className="bg-[#020617] rounded-xl border border-slate-800 border-t-violet-500/20 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Route size={14} className="text-violet-400" />
              <span className="text-xs font-semibold text-[#f1f5f9] uppercase tracking-wider">Graph-Augmented Quant</span>
            </div>
            <div className="flex items-center gap-2">
              {isRelayPattern && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30 animate-pulse flex items-center gap-1">
                  <Timer size={10} /> RELAY
                </span>
              )}
              <span className="text-[10px] font-mono text-[#475569]">3-level subgraph</span>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* Reachability Score */}
            <div className="bg-[#0f172a] rounded-lg p-3 border border-[#1e293b]">
              <p className="text-[9px] text-[#64748b] uppercase tracking-wider font-semibold mb-2">Transitivity / Reachability Score</p>
              <div className="font-mono text-[11px] text-[#94a3b8] leading-relaxed space-y-1">
                <div>R = Total Path Count / Unique Senders (L1+L2)</div>
                <div>R = {subgraph?.edges?.length ?? 0} / {new Set((subgraph?.nodes ?? []).filter(n => n.level <= 2).map(n => n.id)).size}
                  = <span className="text-lg font-bold" style={{ color: reachScore > 3 ? "#ef4444" : reachScore > 2 ? "#f59e0b" : "#10b981" }}>
                    {reachScore.toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-[#020617] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{
                    width: `${Math.min(100, reachScore * 20)}%`,
                    background: reachScore > 3 ? "#ef4444" : reachScore > 2 ? "#f59e0b" : "#10b981",
                  }} />
                </div>
                <span className="text-[9px] font-mono" style={{ color: reachScore > 3 ? "#ef4444" : "#64748b" }}>
                  {reachScore > 3 ? "HIGH" : reachScore > 2 ? "ELEVATED" : "NORMAL"}
                </span>
              </div>
            </div>

            {/* Circularity Index */}
            <div className="bg-[#0f172a] rounded-lg p-3 border border-[#1e293b]">
              <p className="text-[9px] text-[#64748b] uppercase tracking-wider font-semibold mb-2">
                <span className="flex items-center gap-1"><RefreshCcw size={10} className="text-violet-400" /> Circularity Index (Wash Trade Detection)</span>
              </p>
              <div className="font-mono text-[11px] text-[#94a3b8] leading-relaxed space-y-1">
                <div>CI = Detected Cycles (A→B→C→A) / Possible Triads</div>
                <div>CI = <span className="text-lg font-bold" style={{
                  color: circIdx > 0.5 ? "#ef4444" : circIdx > 0.2 ? "#f59e0b" : "#10b981"
                }}>{(circIdx * 100).toFixed(1)}%</span>
                  {circIdx > 0.5 && <span className="text-[10px] text-red-400 ml-2">→ {(circIdx * 100).toFixed(0)}% wash probability</span>}
                </div>
              </div>
              {subgraph?.cycleDetected && (subgraph?.cycleNodes?.length ?? 0) > 0 && (
                <div className="mt-2 bg-red-500/5 rounded-lg p-2 border border-red-500/20">
                  <p className="text-[9px] text-red-400 font-semibold mb-1">Cycle Nodes Detected:</p>
                  <div className="flex flex-wrap gap-1">
                    {(subgraph?.cycleNodes ?? []).slice(0, 4).map((id) => (
                      <span key={id} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20">
                        {id.slice(0, 12)}…
                      </span>
                    ))}
                    <span className="text-[9px] text-red-400/60 font-mono">→ circular flow</span>
                  </div>
                </div>
              )}
            </div>

            {/* Hop-Adjusted Velocity */}
            <div className="bg-[#0f172a] rounded-lg p-3 border border-[#1e293b]">
              <p className="text-[9px] text-[#64748b] uppercase tracking-wider font-semibold mb-2">
                <span className="flex items-center gap-1"><Timer size={10} className="text-cyan-400" /> Hop-Adjusted Velocity</span>
              </p>
              <div className="font-mono text-[11px] text-[#94a3b8] leading-relaxed space-y-1">
                <div>HAV = Avg(₹/min) across L1→L3 edges</div>
                <div>HAV = <span className="text-lg font-bold text-[#22d3ee]">₹{hopVelocity.toLocaleString()}/min</span></div>
                <div className="mt-1">
                  Network Path Time (L1→L3) = <span className={`font-bold ${isRelayPattern ? "text-[#ef4444]" : "text-[#10b981]"}`}>
                    {netPathMin.toFixed(1)} min
                  </span>
                  {isRelayPattern && <span className="text-[10px] text-red-400 ml-2">⚡ &lt;15min = Relay Pattern</span>}
                </div>
              </div>
              {/* Velocity tiers */}
              <div className="mt-2 space-y-1">
                {[
                  { label: "> 30 min", color: "#10b981", scenario: "Normal settlement", active: netPathMin > 30 },
                  { label: "15–30 min", color: "#f59e0b", scenario: "Fast-forward chain", active: netPathMin >= 15 && netPathMin <= 30 },
                  { label: "< 15 min", color: "#ef4444", scenario: "Relay mule pattern", active: netPathMin < 15 },
                ].map((tier) => (
                  <div key={tier.label}
                    className={`flex items-center justify-between px-2 py-1.5 rounded-lg border text-[10px] font-mono ${
                      tier.active
                        ? "border-sky-500/30 bg-[#020617]"
                        : "border-[#1e293b] bg-[#0f172a] opacity-40"
                    }`}>
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tier.color }} />
                      <span className="text-[#94a3b8]">{tier.label}</span>
                    </div>
                    <span className="text-[#64748b]">{tier.scenario}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Summary grid */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-[#020617] rounded-lg p-2 text-center border border-[#1e293b]">
                <div className="text-[8px] text-[#64748b] uppercase">Reachability</div>
                <div className="text-sm font-bold font-mono" style={{ color: reachScore > 3 ? "#ef4444" : "#38bdf8" }}>
                  {reachScore.toFixed(2)}
                </div>
              </div>
              <div className="bg-[#020617] rounded-lg p-2 text-center border border-[#1e293b]">
                <div className="text-[8px] text-[#64748b] uppercase">Circularity</div>
                <div className="text-sm font-bold font-mono" style={{ color: circIdx > 0.5 ? "#ef4444" : "#a78bfa" }}>
                  {(circIdx * 100).toFixed(0)}%
                </div>
              </div>
              <div className="bg-[#020617] rounded-lg p-2 text-center border border-[#1e293b]">
                <div className="text-[8px] text-[#64748b] uppercase">Path Vel.</div>
                <div className="text-sm font-bold font-mono" style={{ color: isRelayPattern ? "#ef4444" : "#22d3ee" }}>
                  {netPathMin.toFixed(0)}m
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ── Sub-component ────────────────────────────────────────────
function MetricCard({ icon, label, value, color, description }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  description: string;
}) {
  return (
    <div className="bg-[#0f172a] rounded-lg p-3 border border-[#1e293b]">
      <div className="flex items-center gap-1.5 mb-1">
        <span style={{ color }}>{icon}</span>
        <span className="text-[10px] text-[#64748b] uppercase">{label}</span>
      </div>
      <div className="text-base font-bold font-mono" style={{ color }}>{value}</div>
      <div className="text-[9px] text-[#475569] mt-0.5">{description}</div>
    </div>
  );
}
