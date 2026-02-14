"use client";

import { formatINR, formatNumber } from "@/lib/utils";
import { Activity, Shield, Zap, Clock, AlertTriangle, Ban } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
}

function MetricCard({ label, value, unit, icon, color, subtitle }: MetricCardProps) {
  return (
    <div className="bg-[#0f172a] border border-slate-800 border-t-sky-500/20 rounded-xl p-4 flex flex-col gap-2 transition-shadow hover:shadow-[0_0_12px_rgba(56,189,248,0.06)]">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${color}15` }}>
          <div style={{ color }}>{icon}</div>
        </div>
        <span className="text-xs text-[#64748b] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold font-mono" style={{ color }}>{value}</span>
        {unit && <span className="text-sm text-[#64748b] font-mono">{unit}</span>}
      </div>
      {subtitle && <span className="text-xs text-[#64748b]">{subtitle}</span>}
    </div>
  );
}

interface MetricsPanelProps {
  tps: number;
  meanLatencyMs: number;
  totalProcessed: number;
  totalBlocked: number;
  blockedVolume: number;
  globalRiskAvg: number;
}

export function MetricsPanel({
  tps, meanLatencyMs, totalProcessed, totalBlocked, blockedVolume, globalRiskAvg,
}: MetricsPanelProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <MetricCard
        label="TPS"
        value={tps}
        unit="tx/s"
        icon={<Zap size={16} />}
        color="#38bdf8"
        subtitle="Target: 500 TPS"
      />
      <MetricCard
        label="Mean Latency"
        value={meanLatencyMs}
        unit="ms"
        icon={<Clock size={16} />}
        color={meanLatencyMs < 200 ? "#10b981" : "#f59e0b"}
        subtitle={meanLatencyMs < 200 ? "✓ Under 200ms target" : "⚠ Above 200ms target"}
      />
      <MetricCard
        label="Risk Level"
        value={Math.round(globalRiskAvg)}
        unit="/100"
        icon={<AlertTriangle size={16} />}
        color={globalRiskAvg > 50 ? "#ef4444" : globalRiskAvg > 30 ? "#f59e0b" : "#10b981"}
        subtitle="60s moving avg"
      />
      <MetricCard
        label="Processed"
        value={formatNumber(totalProcessed)}
        icon={<Activity size={16} />}
        color="#a78bfa"
        subtitle="This session"
      />
      <MetricCard
        label="Blocked"
        value={totalBlocked}
        icon={<Ban size={16} />}
        color="#ef4444"
        subtitle={`${totalProcessed > 0 ? ((totalBlocked / totalProcessed) * 100).toFixed(1) : 0}% block rate`}
      />
      <MetricCard
        label="Blocked Vol."
        value={formatINR(blockedVolume)}
        icon={<Shield size={16} />}
        color="#f59e0b"
        subtitle="Fraud prevented"
      />
    </div>
  );
}
