"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  type AggregatorNode,
  type ASNEntry,
  type DeviceCluster,
  type Transaction,
} from "@/lib/types";
import {
  fetchAggregators,
  fetchASNDensity,
  fetchDeviceClusters,
  fetchASNTransactions,
  fetchNodeTransactions,
} from "@/lib/api";
import { formatINR, getRiskColor, getRiskBadgeClass, getRiskLabel, timeAgo } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Treemap,
} from "recharts";
import { Shield, Users, Cpu, AlertTriangle, Ban, ArrowRight, X, Eye } from "lucide-react";
import { ResizableSidebar } from "../ui/ResizableSidebar";
import { IntelligencePanel } from "../intelligence/IntelligencePanel";

interface MuleManagementProps {
  onOpenFullAnalysis?: (tx: Transaction) => void;
  onContextMenu?: (e: React.MouseEvent, tx: Transaction) => void;
}

export function MuleManagement({ onOpenFullAnalysis, onContextMenu }: MuleManagementProps) {
  const [aggregators, setAggregators] = useState<AggregatorNode[]>([]);
  const [asnData, setAsnData] = useState<ASNEntry[]>([]);
  const [deviceClusters, setDeviceClusters] = useState<DeviceCluster[]>([]);
  const [selectedTab, setSelectedTab] = useState<"aggregators" | "asn" | "devices">("aggregators");
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);

  // ASN drill-down state
  const [selectedASN, setSelectedASN] = useState<string | null>(null);
  const [asnTransactions, setAsnTransactions] = useState<Transaction[]>([]);

  // Fetch data from backend on mount
  useEffect(() => {
    fetchAggregators(20).then(setAggregators).catch(() => {});
    fetchASNDensity().then(setAsnData).catch(() => {});
    fetchDeviceClusters(2).then(setDeviceClusters).catch(() => {});
  }, []);

  // ASN drill-down
  useEffect(() => {
    if (!selectedASN) { setAsnTransactions([]); return; }
    fetchASNTransactions(selectedASN, 15).then(setAsnTransactions).catch(() => setAsnTransactions([]));
  }, [selectedASN]);

  const handleSelectTx = useCallback((tx: Transaction) => {
    setSelectedTx(tx);
    setShowSidebar(true);
  }, []);

  const handleASNClick = useCallback((provider: string) => {
    setSelectedASN((prev) => (prev === provider ? null : provider));
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 py-3 border-b border-[#1e293b] shrink-0">
          {[
            { key: "aggregators" as const, label: "Top Aggregators", icon: <Shield size={14} /> },
            { key: "asn" as const, label: "ASN Density", icon: <AlertTriangle size={14} /> },
            { key: "devices" as const, label: "Device Farms", icon: <Cpu size={14} /> },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setSelectedTab(tab.key); setSelectedASN(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selectedTab === tab.key
                  ? "bg-[#1e293b] text-[#f1f5f9]"
                  : "text-[#64748b] hover:text-[#94a3b8]"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}

          <div className="flex-1" />

          {/* Sidebar toggle */}
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              showSidebar
                ? "bg-violet-500/15 text-violet-300 border border-violet-500/30"
                : "bg-[#0f172a] text-[#64748b] border border-[#1e293b] hover:text-[#94a3b8] hover:border-[#334155]"
            }`}
          >
            <Eye size={12} />
            Intelligence Panel
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {selectedTab === "aggregators" && (
            <AggregatorsTable
              aggregators={aggregators}
              onSelectTx={handleSelectTx}
              onContextMenu={onContextMenu}
            />
          )}
          {selectedTab === "asn" && (
            <>
              <ASNDensity
                data={asnData}
                selectedASN={selectedASN}
                onASNClick={handleASNClick}
              />
              {/* ASN Drill-down Transactions */}
              {selectedASN && asnTransactions.length > 0 && (
                <ASNTransactionDrillDown
                  provider={selectedASN}
                  transactions={asnTransactions}
                  onClose={() => setSelectedASN(null)}
                  onSelectTx={handleSelectTx}
                  onOpenFullAnalysis={onOpenFullAnalysis}
                  onContextMenu={onContextMenu}
                />
              )}
            </>
          )}
          {selectedTab === "devices" && <DeviceFarms clusters={deviceClusters} />}
        </div>
      </div>

      {/* Resizable Intelligence Sidebar */}
      {showSidebar && (
        <ResizableSidebar defaultWidth={380} minWidth={300} maxWidth={600} side="right" className="border-l border-slate-800 bg-[#0f172a]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
            <span className="text-xs font-semibold text-[#f1f5f9] uppercase tracking-wider">Risk Intelligence</span>
            <button onClick={() => setShowSidebar(false)} className="text-[#64748b] hover:text-[#f1f5f9] transition-colors">
              <X size={14} />
            </button>
          </div>
          <IntelligencePanel transaction={selectedTx} />
          {selectedTx && onOpenFullAnalysis && (
            <div className="px-4 py-3 border-t border-slate-800">
              <button
                onClick={() => onOpenFullAnalysis(selectedTx)}
                className="w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-[#a78bfa]/10 to-[#38bdf8]/10 border border-violet-500/30 text-violet-300 hover:border-violet-500/50 transition-all"
              >
                <Eye size={12} />
                Open Full Deep Analysis
              </button>
            </div>
          )}
        </ResizableSidebar>
      )}
    </div>
  );
}

// ── Aggregators Table ────────────────────────────────────────

function AggregatorsTable({ aggregators, onSelectTx, onContextMenu }: {
  aggregators: AggregatorNode[];
  onSelectTx: (tx: Transaction) => void;
  onContextMenu?: (e: React.MouseEvent, tx: Transaction) => void;
}) {
  const makeAggTx = (agg: AggregatorNode): Transaction => ({
    id: `agg_${agg.id}_${Date.now()}`,
    timestamp: new Date(),
    senderName: agg.name,
    senderUPI: agg.upi,
    receiverName: "",
    receiverUPI: "",
    amount: agg.totalVolume,
    status: "SUCCESS",
    riskScore: agg.riskScore,
    latencyMs: 0,
    senderIP: "",
    deviceId: "",
    city: "",
    features: { graph: agg.betweennessCentrality * 100, behavioral: 0, device: 0, deadAccount: 0, velocity: 0 },
    triggeredRules: [],
    geoEvidence: { deviceGeo: { city: "", lat: 0, lng: 0 }, ipGeo: { city: "", lat: 0, lng: 0 }, distanceKm: 0, timeDeltaMin: 0, speedKmh: 0, isImpossible: false },
    behavioralSignature: { amountEntropy: 50, fanInRatio: 25, temporalAlignment: 80, deviceAging: 85, networkDiversity: 20, velocityBurst: 15, circadianBitmask: 80, ispConsistency: 85 },
    semanticAlert: "",
    probabilityMatrix: [],
  });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[#f1f5f9] flex items-center gap-2">
        <Shield size={16} className="text-[#ef4444]" />
        Top 10 Aggregators by Betweenness Centrality
      </h3>
      <p className="text-xs text-[#64748b]">Click any row to inspect in the intelligence panel. Right-click for full analysis.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[#64748b] border-b border-[#1e293b]">
              <th className="text-left py-2 px-2 font-semibold">#</th>
              <th className="text-left py-2 px-2 font-semibold">Name</th>
              <th className="text-left py-2 px-2 font-semibold">UPI</th>
              <th className="text-right py-2 px-2 font-semibold">BC</th>
              <th className="text-right py-2 px-2 font-semibold">PageRank</th>
              <th className="text-right py-2 px-2 font-semibold">Fan-In/Out</th>
              <th className="text-right py-2 px-2 font-semibold">Volume</th>
              <th className="text-center py-2 px-2 font-semibold">Risk</th>
              <th className="text-center py-2 px-2 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {aggregators.map((agg, i) => (
              <tr
                key={agg.id}
                onClick={() => onSelectTx(makeAggTx(agg))}
                onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); onContextMenu(e, makeAggTx(agg)); } }}
                className="border-b border-[#1e293b]/50 hover:bg-[#1e293b]/30 transition-colors cursor-pointer"
              >
                <td className="py-2.5 px-2 font-mono text-[#64748b]">{i + 1}</td>
                <td className="py-2.5 px-2 font-medium text-[#f1f5f9]">{agg.name}</td>
                <td className="py-2.5 px-2 font-mono text-[#94a3b8]">{agg.upi.slice(0, 15)}…</td>
                <td className="py-2.5 px-2 text-right font-mono" style={{ color: "#a78bfa" }}>
                  {agg.betweennessCentrality.toFixed(4)}
                </td>
                <td className="py-2.5 px-2 text-right font-mono text-[#38bdf8]">
                  {agg.pageRank.toFixed(4)}
                </td>
                <td className="py-2.5 px-2 text-right font-mono text-[#94a3b8]">
                  {agg.fanIn}/{agg.fanOut}
                </td>
                <td className="py-2.5 px-2 text-right font-mono text-[#f59e0b]">
                  {formatINR(agg.totalVolume)}
                </td>
                <td className="py-2.5 px-2 text-center">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getRiskBadgeClass(agg.riskScore)}`}>
                    {agg.riskScore}
                  </span>
                </td>
                <td className="py-2.5 px-2 text-center">
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="px-2 py-1 rounded text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors"
                  >
                    <Ban size={10} className="inline mr-1" />
                    Block
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── ASN Density ──────────────────────────────────────────────

function ASNDensity({ data, selectedASN, onASNClick }: {
  data: ASNEntry[];
  selectedASN: string | null;
  onASNClick: (provider: string) => void;
}) {
  const treemapData = data.map((d) => ({
    name: d.provider,
    size: d.txCount,
    riskRatio: d.riskTxCount / d.txCount,
    isRisky: d.isRisky,
  }));

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[#f1f5f9] flex items-center gap-2">
        <AlertTriangle size={16} className="text-[#f59e0b]" />
        ASN Provider Distribution
      </h3>
      <p className="text-xs text-[#64748b]">
        Click any ASN provider to drill-down into its transactions. Cloud providers signal scripted bot attacks.
      </p>

      {/* Treemap */}
      <div className="h-64 bg-[#020617] rounded-xl border border-[#1e293b] p-2">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={treemapData}
            dataKey="size"
            aspectRatio={4 / 3}
            stroke="#1e293b"
            content={({ x, y, width, height, name, isRisky }: any) => {
              const isSelected = name === selectedASN;
              return (
                <g onClick={() => onASNClick(name)} style={{ cursor: "pointer" }}>
                  <rect
                    x={x} y={y} width={width} height={height}
                    fill={isSelected ? "rgba(167, 139, 250, 0.35)" : isRisky ? "rgba(239, 68, 68, 0.25)" : "rgba(56, 189, 248, 0.12)"}
                    stroke={isSelected ? "#a78bfa" : "#1e293b"}
                    strokeWidth={isSelected ? 2 : 1}
                    rx={4}
                  />
                  {width > 50 && height > 25 && (
                    <text
                      x={x + width / 2} y={y + height / 2}
                      textAnchor="middle" dominantBaseline="middle"
                      fill={isSelected ? "#e0e7ff" : isRisky ? "#fca5a5" : "#94a3b8"}
                      fontSize={Math.min(12, width / 8)}
                      fontFamily="'Inter', sans-serif"
                      fontWeight={isSelected ? "bold" : "normal"}
                    >
                      {name}
                    </text>
                  )}
                </g>
              );
            }}
          />
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[#64748b] border-b border-[#1e293b]">
              <th className="text-left py-2 px-2 font-semibold">ASN</th>
              <th className="text-left py-2 px-2 font-semibold">Provider</th>
              <th className="text-right py-2 px-2 font-semibold">Total Tx</th>
              <th className="text-right py-2 px-2 font-semibold">Risk Tx</th>
              <th className="text-right py-2 px-2 font-semibold">%</th>
              <th className="text-center py-2 px-2 font-semibold">Status</th>
              <th className="text-center py-2 px-2 font-semibold">Drill</th>
            </tr>
          </thead>
          <tbody>
            {data.map((entry) => (
              <tr
                key={entry.asn}
                onClick={() => onASNClick(entry.provider)}
                className={`border-b border-[#1e293b]/50 transition-colors cursor-pointer ${
                  selectedASN === entry.provider
                    ? "bg-violet-500/10 border-violet-500/20"
                    : "hover:bg-[#1e293b]/30"
                }`}
              >
                <td className="py-2 px-2 font-mono text-[#94a3b8]">{entry.asn}</td>
                <td className={`py-2 px-2 font-medium ${selectedASN === entry.provider ? "text-violet-300" : "text-[#f1f5f9]"}`}>
                  {entry.provider}
                </td>
                <td className="py-2 px-2 text-right font-mono text-[#94a3b8]">{entry.txCount.toLocaleString()}</td>
                <td className="py-2 px-2 text-right font-mono text-[#ef4444]">{entry.riskTxCount}</td>
                <td className="py-2 px-2 text-right font-mono text-[#64748b]">{entry.percentage}%</td>
                <td className="py-2 px-2 text-center">
                  {entry.isRisky ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">
                      ⚠ CLOUD
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      ISP
                    </span>
                  )}
                </td>
                <td className="py-2 px-2 text-center">
                  <ArrowRight size={12} className={selectedASN === entry.provider ? "text-violet-400" : "text-[#475569]"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── ASN Transaction Drill-Down ───────────────────────────────

function ASNTransactionDrillDown({ provider, transactions, onClose, onSelectTx, onOpenFullAnalysis, onContextMenu }: {
  provider: string;
  transactions: Transaction[];
  onClose: () => void;
  onSelectTx: (tx: Transaction) => void;
  onOpenFullAnalysis?: (tx: Transaction) => void;
  onContextMenu?: (e: React.MouseEvent, tx: Transaction) => void;
}) {
  return (
    <div className="mt-6 bg-[#0f172a] rounded-xl border border-violet-500/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-violet-500/5">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-violet-400" />
          <span className="text-xs font-semibold text-[#f1f5f9] uppercase tracking-wider">
            Transactions from <span className="text-violet-300">{provider}</span>
          </span>
          <span className="text-[10px] font-mono text-[#64748b]">({transactions.length} results)</span>
        </div>
        <button onClick={onClose} className="text-[#64748b] hover:text-[#f1f5f9] transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Transaction rows */}
      <div className="divide-y divide-[#1e293b]/50 max-h-[400px] overflow-y-auto">
        {transactions.map((tx) => (
          <div
            key={tx.id}
            onClick={() => onSelectTx(tx)}
            onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); onContextMenu(e, tx); } }}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#1e293b]/30 transition-colors cursor-pointer group"
          >
            {/* Risk dot */}
            <div
              className={`w-2 h-2 rounded-full shrink-0 ${tx.riskScore >= 80 ? "animate-pulse" : ""}`}
              style={{ backgroundColor: getRiskColor(tx.riskScore) }}
            />

            {/* Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-[#94a3b8] truncate">{(tx.senderUPI || "unknown").split("@")[0].slice(0, 8)}…</span>
                <span className="text-[#475569]">→</span>
                <span className="font-mono text-[#94a3b8] truncate">{(tx.receiverUPI || "unknown").split("@")[0].slice(0, 8)}…</span>
              </div>
              <div className="text-[10px] text-[#475569] mt-0.5">{tx.city || "—"} · {tx.latencyMs ?? 0}ms</div>
            </div>

            {/* Amount + Risk */}
            <div className="text-right shrink-0">
              <div className="text-xs font-mono font-semibold" style={{ color: getRiskColor(tx.riskScore) }}>
                {formatINR(tx.amount)}
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getRiskBadgeClass(tx.riskScore)}`}>
                {getRiskLabel(tx.riskScore)} {tx.riskScore}
              </span>
            </div>

            {/* Full Analysis button */}
            {onOpenFullAnalysis && (
              <button
                onClick={(e) => { e.stopPropagation(); onOpenFullAnalysis(tx); }}
                className="opacity-0 group-hover:opacity-100 px-2 py-1 rounded text-[10px] font-semibold bg-violet-500/15 text-violet-300 border border-violet-500/30 hover:bg-violet-500/25 transition-all shrink-0"
              >
                <Eye size={10} className="inline mr-1" />
                Analyze
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Device Farms ─────────────────────────────────────────────

function DeviceFarms({ clusters }: { clusters: DeviceCluster[] }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[#f1f5f9] flex items-center gap-2">
        <Cpu size={16} className="text-[#22d3ee]" />
        Device Farm Heatmap
      </h3>
      <p className="text-xs text-[#64748b]">
        Devices shared by 5+ users indicate device farming operations.
      </p>

      {/* Bar chart */}
      <div className="h-48 bg-[#020617] rounded-xl border border-[#1e293b] p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={clusters.slice(0, 12)} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <XAxis dataKey="deviceId" tick={false} axisLine={{ stroke: "#1e293b" }} />
            <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={{ stroke: "#1e293b" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid #1e293b",
                borderRadius: "8px",
                fontSize: "11px",
                color: "#f1f5f9",
              }}
              formatter={(value: any) => [`${value} users`, "Users"]}
            />
            <Bar dataKey="userCount" radius={[4, 4, 0, 0]}>
              {clusters.slice(0, 12).map((c, i) => (
                <Cell key={i} fill={c.userCount > 4 ? "#ef4444" : c.userCount > 2 ? "#f59e0b" : "#10b981"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Device cards */}
      <div className="grid grid-cols-2 gap-3">
        {clusters.slice(0, 6).map((cluster) => (
          <div
            key={cluster.deviceId}
            className={`p-3 rounded-xl border transition-colors ${
              cluster.userCount > 4
                ? "bg-red-500/5 border-red-500/20"
                : "bg-[#0f172a] border-[#1e293b]"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono text-[#94a3b8] truncate">{cluster.deviceId.slice(0, 16)}…</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getRiskBadgeClass(cluster.riskScore)}`}>
                {cluster.riskScore}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mb-2">
              <Users size={12} className="text-[#64748b]" />
              <span className="text-sm font-bold font-mono" style={{ color: cluster.userCount > 4 ? "#ef4444" : "#38bdf8" }}>
                {cluster.userCount}
              </span>
              <span className="text-xs text-[#64748b]">users</span>
            </div>
            <div className="text-[10px] text-[#64748b]">
              Seen: {timeAgo(cluster.firstSeen)} — {timeAgo(cluster.lastSeen)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
