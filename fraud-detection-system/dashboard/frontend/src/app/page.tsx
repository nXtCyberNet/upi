"use client";

import { useState, useEffect, useCallback } from "react";
import { useMockStream } from "@/hooks/useMockStream";
import { RiskGauge } from "@/components/gauges/RiskGauge";
import { LatencyHeatmap } from "@/components/gauges/LatencyHeatmap";
import { TransactionStream } from "@/components/stream/TransactionStream";
import { MetricsPanel } from "@/components/metrics/MetricsPanel";
import { GraphExplorer } from "@/components/graph/GraphExplorer";
import { IntelligencePanel } from "@/components/intelligence/IntelligencePanel";
import { MuleManagement } from "@/components/mule/MuleManagement";
import { SystemHealthBar } from "@/components/system/SystemHealthBar";
import { TPSChart, RiskChart, RiskDistributionChart } from "@/components/charts/Charts";
import { QuantDrawer } from "@/components/intelligence/QuantDrawer";
import { type Transaction, type GraphNode } from "@/lib/types";
import { fetchSubgraph, fetchNodeTransactions } from "@/lib/api";
import {
  Activity, Network, Brain, Shield, Play, Pause,
  Radio, Zap,
} from "lucide-react";
import { TransactionContextMenu, useContextMenu } from "@/components/ui/TransactionContextMenu";
import { FullAnalysisView } from "@/components/analysis/FullAnalysisView";

type Tab = "pulse" | "graph" | "intelligence" | "mule";

export default function Dashboard() {
  // ── Hydration guard: defer all random/Date-dependent rendering to client ──
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const {
    transactions, systemHealth, latencyBuckets, isPaused, togglePause,
    totalProcessed, totalBlocked, blockedVolume, globalRiskAvg, connected,
  } = useMockStream();

  const [activeTab, setActiveTab] = useState<Tab>("pulse");
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [quantTx, setQuantTx] = useState<Transaction | null>(null);
  const [fullAnalysisTx, setFullAnalysisTx] = useState<Transaction | null>(null);

  // Context menu hook
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();

  // Cross-tab: Graph Explorer → Intelligence tab
  // Fetches the node's real transactions and navigates
  const handleInspectNode = useCallback(async (node: GraphNode) => {
    try {
      const txs = await fetchNodeTransactions(node.id, 1);
      const baseTx: Transaction = txs.length > 0 ? txs[0] : {
        id: `node_${node.id}_${Date.now()}`,
        timestamp: new Date(),
        senderName: node.name,
        senderUPI: node.upi,
        receiverName: "",
        receiverUPI: "",
        amount: 0,
        status: "SUCCESS",
        riskScore: node.riskScore,
        latencyMs: 0,
        senderIP: "",
        deviceId: "",
        city: node.city,
        features: { graph: 0, behavioral: 0, device: 0, deadAccount: 0, velocity: 0 },
        triggeredRules: [],
        geoEvidence: { deviceGeo: { city: "", lat: 0, lng: 0 }, ipGeo: { city: "", lat: 0, lng: 0 }, distanceKm: 0, timeDeltaMin: 0, speedKmh: 0, isImpossible: false },
        behavioralSignature: { amountEntropy: 50, fanInRatio: 25, temporalAlignment: 80, deviceAging: 85, networkDiversity: 20, velocityBurst: 15, circadianBitmask: 80, ispConsistency: 85 },
        semanticAlert: "",
        probabilityMatrix: [],
      };
      const tx: Transaction = {
        ...baseTx,
        senderName: node.name,
        senderUPI: node.upi,
        city: node.city,
        riskScore: node.riskScore,
      };
      setSelectedTx(tx);
      setQuantTx(tx);
      setActiveTab("intelligence");
    } catch (err) {
      console.warn("Failed to fetch node transactions:", err);
    }
  }, []);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "pulse", label: "Transaction Pulse", icon: <Activity size={16} /> },
    { key: "graph", label: "Graph Explorer", icon: <Network size={16} /> },
    { key: "intelligence", label: "Intelligence", icon: <Brain size={16} /> },
    { key: "mule", label: "Mule Management", icon: <Shield size={16} /> },
  ];

  // ── SSR Skeleton — prevents hydration mismatch from Math.random / Date.now ──
  if (!mounted) {
    return (
      <div className="flex flex-col h-screen bg-[#020617]">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-800 border-t-sky-500/20 bg-[#020617] shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#38bdf8] to-[#a78bfa] flex items-center justify-center">
              <Zap size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-[#f1f5f9] tracking-tight">Fraud Intelligence Terminal</h1>
              <p className="text-[10px] text-[#64748b] font-mono">MIDNIGHT QUANTUM v2.0 — Initializing…</p>
            </div>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-[#38bdf8] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-mono text-[#64748b]">Connecting to Intelligence Engine…</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#020617] pb-8">
      {/* ── Top Header Bar — Glassmorphism depth ── */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-slate-800 border-t border-t-sky-500/20 bg-[#020617]/95 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#38bdf8] to-[#a78bfa] flex items-center justify-center shadow-[0_0_15px_rgba(56,189,248,0.3)]">
              <Zap size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-[#f1f5f9] tracking-tight">Fraud Intelligence Terminal</h1>
              <p className="text-[10px] text-[#64748b] font-mono">MIDNIGHT QUANTUM v2.0 — UPI Real-Time Detection</p>
            </div>
          </div>
        </div>

        {/* Live indicator + Pause */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Radio size={14} className={isPaused ? "text-[#64748b]" : "text-[#10b981] animate-pulse"} />
            <span className={`text-xs font-semibold font-mono ${isPaused ? "text-[#64748b]" : "text-[#10b981]"}`}>
              {isPaused ? "PAUSED" : "LIVE"}
            </span>
          </div>
          <button
            onClick={togglePause}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#0f172a] border border-slate-800 border-t-sky-500/20 text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[#334155] hover:shadow-[0_0_10px_rgba(56,189,248,0.1)] transition-all"
          >
            {isPaused ? <Play size={12} /> : <Pause size={12} />}
            {isPaused ? "Resume" : "Pause"} Feed
          </button>
        </div>
      </header>

      {/* ── Tab Navigation — Glassmorphism ── */}
      <nav className="flex items-center gap-1 px-5 py-2 border-b border-slate-800 bg-[#020617] shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
              activeTab === tab.key
                ? "bg-[#1e293b] text-[#f1f5f9] border border-slate-700 border-t-sky-500/30 shadow-[0_0_10px_rgba(56,189,248,0.08)]"
                : "text-[#64748b] hover:text-[#94a3b8] hover:bg-[#0f172a] border border-transparent"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-hidden">
        {activeTab === "pulse" && (
          <PulseView
            transactions={transactions}
            systemHealth={systemHealth}
            latencyBuckets={latencyBuckets}
            selectedTx={selectedTx}
            onSelectTx={setSelectedTx}
            onContextMenu={showContextMenu}
            totalProcessed={totalProcessed}
            totalBlocked={totalBlocked}
            blockedVolume={blockedVolume}
            globalRiskAvg={globalRiskAvg}
          />
        )}
        {activeTab === "graph" && (
          <div className="h-full relative">
            <GraphExplorer onInspectNode={handleInspectNode} transactions={transactions} />
          </div>
        )}
        {activeTab === "intelligence" && (
          <div className="h-full grid grid-cols-[1fr_380px] relative">
            <div className="border-r border-slate-800 overflow-y-auto p-4">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-[#f1f5f9] mb-1">Transaction Stream</h2>
                <p className="text-xs text-[#64748b]">Select a transaction to inspect its risk intelligence breakdown</p>
              </div>
              <TransactionStream
                transactions={transactions}
                onSelect={(tx) => { setSelectedTx(tx); setQuantTx(null); }}
                selectedId={selectedTx?.id}
                onContextMenu={showContextMenu}
              />
            </div>
            <div className="flex flex-col overflow-y-auto">
              <IntelligencePanel transaction={selectedTx} />
              {/* Quant Drawer trigger */}
              {selectedTx && (
                <div className="px-4 py-3 border-t border-slate-800">
                  <button
                    onClick={() => setQuantTx(selectedTx)}
                    className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-[#a78bfa]/10 to-[#38bdf8]/10 border border-violet-500/30 text-violet-300 hover:border-violet-500/50 hover:shadow-[0_0_15px_rgba(167,139,250,0.15)] transition-all"
                  >
                    <Brain size={14} />
                    Open Quant Intelligence Drawer
                  </button>
                </div>
              )}
            </div>
            {/* Quant Drawer overlay */}
            {quantTx && (
              <QuantDrawer transaction={quantTx} onClose={() => setQuantTx(null)} />
            )}
          </div>
        )}
        {activeTab === "mule" && (
          <div className="h-full">
            <MuleManagement
              onOpenFullAnalysis={setFullAnalysisTx}
              onContextMenu={showContextMenu}
            />
          </div>
        )}
      </main>

      {/* ── Context Menu Overlay ── */}
      {contextMenu && (
        <TransactionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          transaction={contextMenu.transaction}
          onClose={hideContextMenu}
          onFullAnalysis={(tx) => setFullAnalysisTx(tx)}
          onInspectGraph={(tx) => {
            setSelectedTx(tx);
            setQuantTx(tx);
            setActiveTab("intelligence");
          }}
        />
      )}

      {/* ── Full Analysis Overlay ── */}
      {fullAnalysisTx && (
        <FullAnalysisView
          transaction={fullAnalysisTx}
          onClose={() => setFullAnalysisTx(null)}
        />
      )}

      {/* ── SRE System Health Bar ── */}
      <SystemHealthBar health={systemHealth} wsConnected={connected} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Pulse View — The "Hero" View
// ══════════════════════════════════════════════════════════════

interface PulseViewProps {
  transactions: Transaction[];
  systemHealth: any;
  latencyBuckets: any[];
  selectedTx: Transaction | null;
  onSelectTx: (tx: Transaction) => void;
  onContextMenu: (e: React.MouseEvent, tx: Transaction) => void;
  totalProcessed: number;
  totalBlocked: number;
  blockedVolume: number;
  globalRiskAvg: number;
}

function PulseView({
  transactions, systemHealth, latencyBuckets, selectedTx, onSelectTx, onContextMenu,
  totalProcessed, totalBlocked, blockedVolume, globalRiskAvg,
}: PulseViewProps) {
  return (
    <div className="grid grid-cols-[340px_1fr_320px] h-full gap-0">
      {/* Left: Transaction Stream */}
      <div className="border-r border-slate-800 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 shrink-0">
          <h2 className="text-sm font-semibold text-[#f1f5f9]">Live Transaction Stream</h2>
          <p className="text-[10px] text-[#64748b] mt-0.5 font-mono">{transactions.length} transactions buffered</p>
        </div>
        <div className="flex-1 overflow-hidden px-2 py-2">
          <TransactionStream
            transactions={transactions}
            onSelect={onSelectTx}
            selectedId={selectedTx?.id}
            onContextMenu={onContextMenu}
          />
        </div>
      </div>

      {/* Center: Gauge + Charts */}
      <div className="flex flex-col overflow-y-auto p-4 gap-4">
        {/* Top metrics */}
        <MetricsPanel
          tps={systemHealth.tps}
          meanLatencyMs={systemHealth.meanLatencyMs}
          totalProcessed={totalProcessed}
          totalBlocked={totalBlocked}
          blockedVolume={blockedVolume}
          globalRiskAvg={globalRiskAvg}
        />

        {/* Risk Gauge Center */}
        <div className="flex items-center justify-center py-4">
          <RiskGauge value={globalRiskAvg} size={240} />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-2 gap-4">
          <TPSChart />
          <RiskChart />
        </div>

        <RiskDistributionChart />
      </div>

      {/* Right: Latency + Intelligence preview */}
      <div className="border-l border-slate-800 flex flex-col overflow-y-auto">
        <div className="p-4 border-b border-slate-800">
          <LatencyHeatmap buckets={latencyBuckets} />
        </div>
        <div className="flex-1">
          <IntelligencePanel transaction={selectedTx} />
        </div>
      </div>
    </div>
  );
}
