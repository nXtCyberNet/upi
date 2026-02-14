"use client";

import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from "recharts";
import type { Transaction, FeatureScores } from "@/lib/types";
import { getRiskColor, getRiskLabel, getRiskBadgeClass } from "@/lib/utils";
import { AlertTriangle, Info, Shield } from "lucide-react";
import { GeodesicArcMap } from "./GeodesicArcMap";
import { BehavioralRadar } from "./BehavioralRadar";
import { SemanticAlert } from "./SemanticAlert";
import { ProbabilityMatrix } from "./ProbabilityMatrix";

interface IntelligencePanelProps {
  transaction: Transaction | null;
}

export function IntelligencePanel({ transaction }: IntelligencePanelProps) {
  if (!transaction) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[#64748b] gap-3">
        <Shield size={48} className="opacity-30" />
        <p className="text-sm">Select a transaction to view intelligence</p>
      </div>
    );
  }

  const radarData = [
    { feature: "Graph", value: transaction.features.graph, fullMark: 100 },
    { feature: "Behavioral", value: transaction.features.behavioral, fullMark: 100 },
    { feature: "Device", value: transaction.features.device, fullMark: 100 },
    { feature: "Dead Acct", value: transaction.features.deadAccount, fullMark: 100 },
    { feature: "Velocity", value: transaction.features.velocity, fullMark: 100 },
  ];

  const riskColor = getRiskColor(transaction.riskScore);

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">
      {/* Semantic Explainability Header — Typewriter Marquee */}
      {transaction.semanticAlert && (
        <SemanticAlert alert={transaction.semanticAlert} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#f1f5f9]">Risk Intelligence</h3>
        <span
          className={`text-xs font-bold px-2 py-1 rounded ${getRiskBadgeClass(transaction.riskScore)}`}
        >
          {getRiskLabel(transaction.riskScore)} — {transaction.riskScore}
        </span>
      </div>

      {/* Risk Fusion Formula */}
      <div className="bg-[#020617] rounded-xl border border-[#1e293b] p-4">
        <p className="text-[10px] text-[#64748b] uppercase tracking-wider mb-2 font-semibold">Risk Fusion Formula</p>
        <div className="font-mono text-xs text-[#94a3b8] leading-relaxed">
          <span style={{ color: riskColor }} className="text-base font-bold">R = {transaction.riskScore}</span>
          <div className="mt-2 space-y-1">
            <div>0.30 × <span className="text-[#a78bfa]">Graph({transaction.features.graph})</span> = {(0.30 * transaction.features.graph).toFixed(1)}</div>
            <div>0.25 × <span className="text-[#38bdf8]">Behav({transaction.features.behavioral})</span> = {(0.25 * transaction.features.behavioral).toFixed(1)}</div>
            <div>0.20 × <span className="text-[#22d3ee]">Device({transaction.features.device})</span> = {(0.20 * transaction.features.device).toFixed(1)}</div>
            <div>0.15 × <span className="text-[#f59e0b]">Dead({transaction.features.deadAccount})</span> = {(0.15 * transaction.features.deadAccount).toFixed(1)}</div>
            <div>0.10 × <span className="text-[#ef4444]">Veloc({transaction.features.velocity})</span> = {(0.10 * transaction.features.velocity).toFixed(1)}</div>
          </div>
        </div>
      </div>

      {/* Behavioral Signature Radar — Normal vs Current Overlay */}
      {transaction.behavioralSignature && (
        <BehavioralRadar
          signature={transaction.behavioralSignature}
          riskScore={transaction.riskScore}
        />
      )}

      {/* Feature Contribution Radar */}
      <div className="bg-[#020617] rounded-xl border border-[#1e293b] p-4">
        <p className="text-[10px] text-[#64748b] uppercase tracking-wider mb-2 font-semibold">Feature Contribution Radar</p>
        <ResponsiveContainer width="100%" height={220}>
          <RadarChart data={radarData}>
            <PolarGrid stroke="#1e293b" />
            <PolarAngleAxis dataKey="feature" tick={{ fontSize: 10, fill: "#94a3b8" }} />
            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 8, fill: "#64748b" }} />
            <Radar
              name="Score"
              dataKey="value"
              stroke={riskColor}
              fill={riskColor}
              fillOpacity={0.2}
              strokeWidth={2}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid #1e293b",
                borderRadius: "8px",
                fontSize: "12px",
                color: "#f1f5f9",
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Triggered Rules */}
      <div className="bg-[#020617] rounded-xl border border-[#1e293b] p-4">
        <p className="text-[10px] text-[#64748b] uppercase tracking-wider mb-3 font-semibold">Triggered Rules</p>
        {transaction.triggeredRules.length === 0 ? (
          <p className="text-xs text-[#64748b]">No rules triggered</p>
        ) : (
          <div className="space-y-2">
            {transaction.triggeredRules.map((rule, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-[#0f172a]">
                <div className="mt-0.5">
                  {rule.severity === "CRITICAL" ? (
                    <AlertTriangle size={14} className="text-red-400" />
                  ) : rule.severity === "WARNING" ? (
                    <AlertTriangle size={14} className="text-amber-400" />
                  ) : (
                    <Info size={14} className="text-blue-400" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      rule.severity === "CRITICAL" ? "bg-red-500/15 text-red-400"
                      : rule.severity === "WARNING" ? "bg-amber-500/15 text-amber-400"
                      : "bg-blue-500/15 text-blue-400"
                    }`}>
                      {rule.severity}
                    </span>
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

      {/* Geodesic Arc Evidence Map */}
      {transaction.geoEvidence && (
        <GeodesicArcMap evidence={transaction.geoEvidence} />
      )}

      {/* Probability Matrix */}
      <ProbabilityMatrix transaction={transaction} />
    </div>
  );
}
