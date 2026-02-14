"use client";

import { getRiskColor, getRiskLabel, formatINR, timeAgo } from "@/lib/utils";
import type { GraphNode } from "@/lib/types";
import { X, MapPin, Cpu, Activity, Shield, Users, GitBranch, Crosshair, Brain } from "lucide-react";

interface NodeDrawerProps {
  node: GraphNode;
  onClose: () => void;
  onBlastRadius?: (nodeId: string) => void;
  isBlastActive?: boolean;
  onInspect?: (node: GraphNode) => void;
}

export function NodeDrawer({ node, onClose, onBlastRadius, isBlastActive, onInspect }: NodeDrawerProps) {
  const riskColor = getRiskColor(node.riskScore);

  // Synthesize intelligence sentence from node attributes
  const intelligenceParts: string[] = [];
  if (node.type === "aggregator") intelligenceParts.push(`Aggregator hub with fan-in ${node.fanIn}`);
  else if (node.type === "mule") intelligenceParts.push(`Suspected mule account`);
  if (node.betweennessCentrality > 0.3) intelligenceParts.push(`High bridge centrality (${node.betweennessCentrality.toFixed(3)})`);
  if (node.fanOut > 5) intelligenceParts.push(`Fan-out: ${node.fanOut} unique recipients`);
  if (node.deviceCount > 2) intelligenceParts.push(`Multi-device: ${node.deviceCount} devices`);
  if (node.isFlagged) intelligenceParts.push("Account flagged by risk engine");
  if (node.isBlocked) intelligenceParts.push("BLOCKED by fraud ops");
  const intelligenceSentence = intelligenceParts.length > 0
    ? `[${getRiskLabel(node.riskScore)}] ${intelligenceParts.join(". ")}.`
    : null;

  return (
    <div className="absolute right-0 top-0 bottom-0 w-[360px] bg-[#0f172a] border-l border-slate-800 border-l-sky-500/10 z-50 animate-slide-in overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-[#f1f5f9]">{node.name}</h3>
          <p className="text-xs font-mono text-[#64748b] mt-1">{node.upi}</p>
          <div className="flex items-center gap-2 mt-2">
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded"
              style={{
                backgroundColor: `${riskColor}15`,
                color: riskColor,
                border: `1px solid ${riskColor}30`,
              }}
            >
              {getRiskLabel(node.riskScore)} — {node.riskScore}
            </span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
              node.type === "aggregator" ? "bg-red-500/15 text-red-400 border border-red-500/30"
              : node.type === "mule" ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
              : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
            }`}>
              {node.type.toUpperCase()}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-[#1e293b] text-[#64748b] hover:text-[#f1f5f9]">
          <X size={16} />
        </button>
      </div>

      {/* Intelligence Sentence Marquee */}
      {intelligenceSentence && (
        <div className={`px-4 py-2.5 border-b border-slate-800 ${node.riskScore >= 80 ? "bg-red-500/5" : "bg-sky-500/5"}`}>
          <div className="font-mono text-[11px] leading-relaxed" style={{ color: riskColor }}>
            {intelligenceSentence}
          </div>
        </div>
      )}

      {/* Identity */}
      <div className="p-4 border-b border-slate-800">
        <h4 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider mb-3">Behavioral Identity</h4>
        <div className="grid grid-cols-2 gap-3">
          <InfoItem icon={<MapPin size={14} />} label="City" value={node.city} />
          <InfoItem icon={<Cpu size={14} />} label="Devices" value={`${node.deviceCount} device(s)`} />
          <InfoItem icon={<Activity size={14} />} label="Last Active" value={timeAgo(node.lastActive)} />
          <InfoItem icon={<Shield size={14} />} label="Status" value={node.isBlocked ? "BLOCKED" : node.isFlagged ? "FLAGGED" : "ACTIVE"} />
        </div>
      </div>

      {/* Graph Stats */}
      <div className="p-4 border-b border-slate-800">
        <h4 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider mb-3">Graph Metrics</h4>
        <div className="space-y-3">
          <StatBar label="Betweenness Centrality" value={node.betweennessCentrality} max={1} color="#a78bfa" />
          <StatBar label="PageRank" value={node.pageRank} max={0.15} color="#38bdf8" />
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="bg-[#020617] rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-[#64748b] text-xs mb-1">
                <Users size={12} /> Fan-In
              </div>
              <span className="text-lg font-bold font-mono text-[#38bdf8]">{node.fanIn}</span>
            </div>
            <div className="bg-[#020617] rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-[#64748b] text-xs mb-1">
                <GitBranch size={12} /> Fan-Out
              </div>
              <span className="text-lg font-bold font-mono text-[#a78bfa]">{node.fanOut}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Blast Radius */}
      {onBlastRadius && (
        <div className="p-4 border-b border-slate-800">
          <button
            onClick={() => onBlastRadius(node.id)}
            className={`w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 ${
              isBlastActive
                ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-[0_0_15px_rgba(56,189,248,0.2)]"
                : "bg-[#020617] text-[#94a3b8] border border-slate-800 border-t-sky-500/20 hover:text-sky-300 hover:border-sky-500/30 hover:shadow-[0_0_10px_rgba(56,189,248,0.1)]"
            }`}
          >
            <Crosshair size={14} />
            {isBlastActive ? "Clear Blast Radius" : "Calculate Blast Radius"}
          </button>
          {isBlastActive && (
            <p className="text-[10px] text-[#64748b] font-mono mt-2 text-center">
              3-hop BFS — dimming all nodes outside mule ring
            </p>
          )}
        </div>
      )}

      {/* Deep Intelligence Analysis */}
      {onInspect && (
        <div className="p-4 border-b border-slate-800">
          <button
            onClick={() => onInspect(node)}
            className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-[#a78bfa]/10 to-[#38bdf8]/10 border border-violet-500/30 text-violet-300 hover:border-violet-500/50 hover:shadow-[0_0_15px_rgba(167,139,250,0.15)] transition-all"
          >
            <Brain size={14} />
            Analyze in Intelligence
          </button>
          <p className="text-[10px] text-[#64748b] font-mono mt-2 text-center">
            Opens Quant Intelligence with full risk decomposition
          </p>
        </div>
      )}

      {/* Block Action */}
      {!node.isBlocked && node.isFlagged && (
        <div className="p-4">
          <button className="w-full py-2.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-semibold hover:bg-red-500/30 transition-colors">
            🚫 Block Account
          </button>
        </div>
      )}
    </div>
  );
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="text-[#64748b] mt-0.5">{icon}</div>
      <div>
        <span className="text-[10px] text-[#64748b] uppercase">{label}</span>
        <p className="text-xs text-[#f1f5f9] font-medium">{value}</p>
      </div>
    </div>
  );
}

function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[#94a3b8]">{label}</span>
        <span className="font-mono" style={{ color }}>{value.toFixed(4)}</span>
      </div>
      <div className="h-1.5 bg-[#020617] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
