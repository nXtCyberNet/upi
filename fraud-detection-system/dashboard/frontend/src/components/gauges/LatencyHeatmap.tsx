"use client";

import type { LatencyBucket } from "@/lib/types";

interface LatencyHeatmapProps {
  buckets: LatencyBucket[];
}

function getLatencyColor(ms: number): string {
  if (ms < 50) return "#10b981";
  if (ms < 100) return "#34d399";
  if (ms < 150) return "#a3e635";
  if (ms < 200) return "#f59e0b";
  if (ms < 250) return "#f97316";
  if (ms < 300) return "#ef4444";
  return "#dc2626";
}

export function LatencyHeatmap({ buckets }: LatencyHeatmapProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[#64748b] font-medium">Latency Heatmap</span>
        <span className="text-[10px] text-[#64748b] font-mono">Last 100 txns</span>
      </div>
      <div className="grid grid-cols-10 gap-[3px]">
        {buckets.map((b, i) => (
          <div
            key={i}
            className="aspect-square rounded-sm transition-colors duration-300"
            style={{ backgroundColor: getLatencyColor(b.latencyMs) }}
            title={`${b.latencyMs}ms`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-[#64748b] mt-1">
        <span>&lt;50ms</span>
        <span>100ms</span>
        <span>200ms</span>
        <span>&gt;300ms</span>
      </div>
    </div>
  );
}
