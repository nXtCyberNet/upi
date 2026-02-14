"use client";

import { useState, useEffect, useMemo } from "react";
import type { ProbabilityMatrixRow, Transaction, RealtimeSubgraph } from "@/lib/types";
import { fetchSubgraph } from "@/lib/api";
import { getRiskColor, getRiskLabel } from "@/lib/utils";
import { Calculator, ChevronRight, Network } from "lucide-react";

interface ProbabilityMatrixProps {
  transaction: Transaction;
}

const CATEGORY_ICONS: Record<string, string> = {
  Integrity: "🛡️",
  "Geo-Spatial": "🌍",
  Behavioral: "🧠",
  Phishing: "🎣",
  Temporal: "⏱️",
  "Net Path Vel.": "🔗",
  "Betweenness": "🌐",
  "Geo-IP Conv.": "📡",
  "Identity Den.": "👤",
};

const CATEGORY_COLORS: Record<string, string> = {
  Integrity: "#a78bfa",
  "Geo-Spatial": "#f59e0b",
  Behavioral: "#38bdf8",
  Phishing: "#ef4444",
  Temporal: "#22d3ee",
  "Net Path Vel.": "#c084fc",
  "Betweenness": "#fb923c",
  "Geo-IP Conv.": "#34d399",
  "Identity Den.": "#f472b6",
};

export function ProbabilityMatrix({ transaction }: ProbabilityMatrixProps) {
  const matrix = transaction.probabilityMatrix;

  // Fetch multi-hop metrics from 3-level subgraph
  const [subgraph, setSubgraph] = useState<RealtimeSubgraph | null>(null);
  const subgraphUserId = transaction.senderName || transaction.id;
  useEffect(() => {
    let cancelled = false;
    fetchSubgraph(subgraphUserId).then((sg) => { if (!cancelled) setSubgraph(sg); }).catch(() => {});
    return () => { cancelled = true; };
  }, [subgraphUserId]);

  const multiHopRows: ProbabilityMatrixRow[] = useMemo(() => {
    const npvMin = subgraph?.networkPathVelocityMin ?? 30;
    const btw = subgraph?.betweennessCentrality ?? 0;
    const geoConv = subgraph?.geoIpConvergence ?? 0;
    const idDen = subgraph?.identityDensity ?? 1;

    const npvRaw = Math.min(100, (1 - npvMin / 60) * 100);
    const btwRaw = btw * 100;
    const geoRaw = geoConv * 100;
    const idRaw = Math.min(100, (idDen / 6) * 100);

    return [
      {
        category: "Net Path Vel.",
        rawValue: `${npvMin.toFixed(1)}min L1→L3`,
        weight: 0.10,
        weightedScore: Math.round(Math.max(0, npvRaw) * 0.10 * 10) / 10,
        scenario: npvMin < 15
          ? `Relay pattern: ${npvMin.toFixed(0)}min traversal`
          : "Normal settlement velocity",
      },
      {
        category: "Betweenness",
        rawValue: `${btw.toFixed(3)} (3-hop)`,
        weight: 0.08,
        weightedScore: Math.round(btwRaw * 0.08 * 10) / 10,
        scenario: btw > 0.5
          ? "High bridge centrality in subgraph"
          : "Normal centrality profile",
      },
      {
        category: "Geo-IP Conv.",
        rawValue: `${(geoConv * 100).toFixed(0)}% convergence`,
        weight: 0.06,
        weightedScore: Math.round(geoRaw * 0.06 * 10) / 10,
        scenario: geoConv > 0.6
          ? "IP clustering — possible proxy farm"
          : "Normal IP distribution",
      },
      {
        category: "Identity Den.",
        rawValue: `${idDen.toFixed(1)} users/device`,
        weight: 0.06,
        weightedScore: Math.round(idRaw * 0.06 * 10) / 10,
        scenario: idDen > 3
          ? "Multi-identity device cluster"
          : "Normal device mapping",
      },
    ];
  }, [subgraph]);

  const allRows = [...matrix, ...multiHopRows];
  const totalWeightedScore = allRows.reduce((sum, r) => sum + r.weightedScore, 0);
  const totalWeight = allRows.reduce((sum, r) => sum + r.weight, 0);
  const riskColor = getRiskColor(transaction.riskScore);
  const riskLabel = getRiskLabel(transaction.riskScore);

  // Verdict
  const verdict = transaction.riskScore >= 80
    ? "BLOCK — Immediate intervention required"
    : transaction.riskScore >= 60
    ? "REVIEW — Manual inspection recommended"
    : transaction.riskScore >= 40
    ? "MONITOR — Enhanced surveillance"
    : "PASS — Within acceptable parameters";

  const verdictColor = transaction.riskScore >= 80 ? "#ef4444"
    : transaction.riskScore >= 60 ? "#f59e0b"
    : transaction.riskScore >= 40 ? "#38bdf8"
    : "#10b981";

  return (
    <div className="bg-[#020617] rounded-xl border border-slate-800 border-t-sky-500/20 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator size={14} className="text-violet-400" />
          <span className="text-xs font-semibold text-[#f1f5f9] uppercase tracking-wider">Probability Matrix</span>
        </div>
        <span className="text-[10px] font-mono text-[#64748b]">9-category decomposition</span>
      </div>

      <div className="p-4">
        {/* Table */}
        <div className="rounded-lg border border-[#1e293b] overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[140px_1fr_70px_80px_1fr] gap-0 text-[9px] font-semibold text-[#64748b] uppercase tracking-wider bg-[#0f172a] border-b border-[#1e293b]">
            <div className="px-3 py-2">Risk Category</div>
            <div className="px-3 py-2 border-l border-[#1e293b]">Raw Value</div>
            <div className="px-3 py-2 border-l border-[#1e293b] text-center">Weight</div>
            <div className="px-3 py-2 border-l border-[#1e293b] text-center">Weighted</div>
            <div className="px-3 py-2 border-l border-[#1e293b]">Scenario</div>
          </div>

          {/* Table rows */}
          {allRows.map((row, i) => {
            const catColor = CATEGORY_COLORS[row.category] || "#94a3b8";
            const icon = CATEGORY_ICONS[row.category] || "•";
            const isSignificant = row.weightedScore > 8;
            const isMultiHop = i >= matrix.length;

            return (
              <div key={row.category}>
                {/* Multi-hop section divider */}
                {i === matrix.length && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0f172a] border-b border-t border-slate-700">
                    <Network size={10} className="text-violet-400" />
                    <span className="text-[8px] font-semibold text-violet-400 uppercase tracking-wider">Multi-Hop Graph Metrics</span>
                    <span className="text-[8px] font-mono text-[#475569]">3-level subgraph</span>
                  </div>
                )}
                <div
                  className={`grid grid-cols-[140px_1fr_70px_80px_1fr] gap-0 text-[11px] border-b border-[#1e293b] last:border-b-0 transition-colors ${
                    isSignificant ? "bg-[#0f172a]" : isMultiHop ? "bg-[#0a0f1e]" : "bg-[#020617]"
                  }`}
                >
                {/* Category */}
                <div className="px-3 py-2.5 flex items-center gap-2">
                  <span>{icon}</span>
                  <span className="font-semibold" style={{ color: catColor }}>{row.category}</span>
                </div>

                {/* Raw Value */}
                <div className="px-3 py-2.5 border-l border-[#1e293b] font-mono text-[#94a3b8]">
                  {row.rawValue}
                </div>

                {/* Weight */}
                <div className="px-3 py-2.5 border-l border-[#1e293b] text-center font-mono text-[#64748b]">
                  {(row.weight * 100).toFixed(0)}%
                </div>

                {/* Weighted Score */}
                <div className="px-3 py-2.5 border-l border-[#1e293b] text-center">
                  <span className="font-mono font-semibold" style={{ color: row.weightedScore > 12 ? "#ef4444" : row.weightedScore > 6 ? "#f59e0b" : "#10b981" }}>
                    {row.weightedScore.toFixed(1)}
                  </span>
                </div>

                {/* Scenario */}
                <div className="px-3 py-2.5 border-l border-[#1e293b] text-[10px] text-[#64748b] flex items-center gap-1">
                  {isSignificant && <ChevronRight size={10} className="text-[#f59e0b] shrink-0" />}
                  <span className={isSignificant ? "text-[#94a3b8]" : ""}>{row.scenario}</span>
                </div>
                </div>
              </div>
            );
          })}

          {/* Total row */}
          <div className="grid grid-cols-[140px_1fr_70px_80px_1fr] gap-0 text-[11px] bg-[#0f172a] border-t-2 border-slate-700">
            <div className="px-3 py-3 flex items-center gap-2 font-bold text-[#f1f5f9]">
              <span>Σ</span>
              <span>TOTAL</span>
            </div>
            <div className="px-3 py-3 border-l border-[#1e293b] font-mono text-[#64748b]">—</div>
            <div className="px-3 py-3 border-l border-[#1e293b] text-center font-mono font-semibold text-[#f1f5f9]">
              {(totalWeight * 100).toFixed(0)}%
            </div>
            <div className="px-3 py-3 border-l border-[#1e293b] text-center">
              <span className="font-mono font-bold text-base" style={{ color: riskColor }}>
                {totalWeightedScore.toFixed(1)}
              </span>
            </div>
            <div className="px-3 py-3 border-l border-[#1e293b]">
              <span className="font-semibold text-[10px]" style={{ color: verdictColor }}>
                {verdict}
              </span>
            </div>
          </div>
        </div>

        {/* Score bar */}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-[#64748b]">Composite Risk Score</span>
            <span className="font-bold" style={{ color: riskColor }}>{riskLabel} — {transaction.riskScore}</span>
          </div>
          <div className="h-2 bg-[#0f172a] rounded-full overflow-hidden border border-[#1e293b]">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${transaction.riskScore}%`,
                background: `linear-gradient(90deg, #10b981 0%, #f59e0b 50%, #ef4444 100%)`,
              }}
            />
          </div>
          <div className="flex justify-between text-[8px] font-mono text-[#475569]">
            <span>0 — Safe</span>
            <span>40 — Monitor</span>
            <span>60 — Review</span>
            <span>80 — Block</span>
            <span>100</span>
          </div>
        </div>

        {/* Formula box */}
        <div className="mt-3 bg-[#0f172a] rounded-lg p-3 border border-[#1e293b]">
          <p className="text-[9px] text-[#64748b] uppercase tracking-wider font-semibold mb-1.5">Risk Aggregation</p>
          <div className="font-mono text-[10px] text-[#94a3b8] leading-relaxed">
            {matrix.map((r) => (
              <div key={r.category}>
                <span style={{ color: CATEGORY_COLORS[r.category] }}>{r.weight.toFixed(2)}</span>
                {" × "}
                <span className="text-[#64748b]">{r.category}</span>
                {" = "}
                <span className="text-[#f1f5f9]">{r.weightedScore.toFixed(1)}</span>
              </div>
            ))}
            <div className="mt-1 pt-1 border-t border-[#1e293b]">
              Σ = <span className="text-base font-bold" style={{ color: riskColor }}>{totalWeightedScore.toFixed(1)}</span>
              <span className="text-[#64748b] ml-2">→ {riskLabel}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
