"use client";

import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, Legend,
} from "recharts";
import type { BehavioralSignature } from "@/lib/types";

interface BehavioralRadarProps {
  signature: BehavioralSignature;
  riskScore: number;
}

// "Normal" baseline profile for a legitimate user (8-axis)
const NORMAL_PROFILE: BehavioralSignature = {
  amountEntropy: 72,
  fanInRatio: 25,
  temporalAlignment: 80,
  deviceAging: 85,
  networkDiversity: 20,
  velocityBurst: 15,
  circadianBitmask: 80,
  ispConsistency: 85,
};

export function BehavioralRadar({ signature, riskScore }: BehavioralRadarProps) {
  const isHighRisk = riskScore >= 60;

  const data = [
    { axis: "Amt Entropy", current: signature.amountEntropy, normal: NORMAL_PROFILE.amountEntropy, fullMark: 100 },
    { axis: "Fan-In Ratio", current: signature.fanInRatio, normal: NORMAL_PROFILE.fanInRatio, fullMark: 100 },
    { axis: "Temporal Align", current: signature.temporalAlignment, normal: NORMAL_PROFILE.temporalAlignment, fullMark: 100 },
    { axis: "Device Age", current: signature.deviceAging, normal: NORMAL_PROFILE.deviceAging, fullMark: 100 },
    { axis: "ASN Diversity", current: signature.networkDiversity, normal: NORMAL_PROFILE.networkDiversity, fullMark: 100 },
    { axis: "Vel. Burst", current: signature.velocityBurst, normal: NORMAL_PROFILE.velocityBurst, fullMark: 100 },
    { axis: "Circadian", current: signature.circadianBitmask, normal: NORMAL_PROFILE.circadianBitmask, fullMark: 100 },
    { axis: "ISP Cons.", current: signature.ispConsistency, normal: NORMAL_PROFILE.ispConsistency, fullMark: 100 },
  ];

  return (
    <div className="bg-[#020617] rounded-xl border border-[#1e293b] p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] text-[#64748b] uppercase tracking-wider font-semibold">
          Behavioral Signature Radar
        </p>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            isHighRisk
              ? "bg-red-500/15 text-red-400 border border-red-500/30"
              : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
          }`}>
            {isHighRisk ? "MULE PROFILE" : "NORMAL PROFILE"}
          </span>
          <span className="text-[9px] font-mono text-[#475569]">8-axis</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="68%">
          <PolarGrid stroke="#1e293b" strokeDasharray="3 3" />
          <PolarAngleAxis
            dataKey="axis"
            tick={{ fontSize: 8, fill: "#94a3b8", fontFamily: "'Inter', sans-serif" }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fontSize: 7, fill: "#475569" }}
            axisLine={false}
          />

          {/* Normal profile (green overlay) */}
          <Radar
            name="Normal Profile"
            dataKey="normal"
            stroke="#10b981"
            fill="#10b981"
            fillOpacity={0.06}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />

          {/* Current transaction (red or blue) */}
          <Radar
            name="Current Tx"
            dataKey="current"
            stroke={isHighRisk ? "#ef4444" : "#38bdf8"}
            fill={isHighRisk ? "#ef4444" : "#38bdf8"}
            fillOpacity={0.12}
            strokeWidth={2}
          />

          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: "8px",
              fontSize: "11px",
              color: "#f1f5f9",
              fontFamily: "'JetBrains Mono', monospace",
            }}
            formatter={(value: any, name: any) => [
              `${value}`,
              name === "Normal Profile" ? "Normal" : "Current",
            ]}
          />

          <Legend
            wrapperStyle={{ fontSize: "10px", color: "#94a3b8", paddingTop: "4px" }}
            iconType="line"
            formatter={(value: string) => (
              <span style={{ color: value === "Normal Profile" ? "#10b981" : isHighRisk ? "#ef4444" : "#38bdf8", fontSize: "10px" }}>
                {value}
              </span>
            )}
          />
        </RadarChart>
      </ResponsiveContainer>

      {/* Axis legend details — 8 columns */}
      <div className="grid grid-cols-4 gap-1.5 mt-2">
        {data.map((d) => {
          const deviation = d.current - d.normal;
          const deviationColor = Math.abs(deviation) > 25 ? "#ef4444" : Math.abs(deviation) > 10 ? "#f59e0b" : "#10b981";
          return (
            <div key={d.axis} className="text-center bg-[#0f172a] rounded-lg p-1.5">
              <div className="text-[8px] text-[#64748b] mb-0.5 truncate">{d.axis}</div>
              <div className="text-[11px] font-mono font-semibold" style={{ color: deviationColor }}>
                {d.current}
              </div>
              <div className="text-[8px] font-mono text-[#475569]">
                {deviation >= 0 ? "+" : ""}{deviation} Δ
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
