"use client";

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart,
} from "recharts";
import { useState, useEffect, useMemo } from "react";
import { fetchTPSSeries, fetchRiskDistribution } from "@/lib/api";

export function TPSChart() {
  const [data, setData] = useState<{ time: string; tps: number; risk: number }[]>([]);

  useEffect(() => {
    fetchTPSSeries(300, 5).then(setData).catch(() => {});
    const interval = setInterval(() => {
      fetchTPSSeries(300, 5).then(setData).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-[#0f172a] border border-slate-800 border-t-sky-500/20 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[#64748b] font-semibold uppercase tracking-wider">TPS Throughput</span>
        <span className="text-xs font-mono text-[#38bdf8]">60s window</span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="tpsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={{ stroke: "#1e293b" }} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={{ stroke: "#1e293b" }} tickLine={false} domain={[300, 600]} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: "8px",
              fontSize: "11px",
              color: "#f1f5f9",
            }}
          />
          <Area type="monotone" dataKey="tps" stroke="#38bdf8" fill="url(#tpsGradient)" strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RiskChart() {
  const [data, setData] = useState<{ time: string; tps: number; risk: number }[]>([]);

  useEffect(() => {
    fetchTPSSeries(300, 5).then(setData).catch(() => {});
    const interval = setInterval(() => {
      fetchTPSSeries(300, 5).then(setData).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-[#0f172a] border border-slate-800 border-t-sky-500/20 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[#64748b] font-semibold uppercase tracking-wider">Risk Trend</span>
        <span className="text-xs font-mono text-[#f59e0b]">60s moving avg</span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="riskGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="time" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={{ stroke: "#1e293b" }} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={{ stroke: "#1e293b" }} tickLine={false} domain={[0, 100]} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: "8px",
              fontSize: "11px",
              color: "#f1f5f9",
            }}
          />
          <Area type="monotone" dataKey="risk" stroke="#ef4444" fill="url(#riskGradient)" strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RiskDistributionChart() {
  const [data, setData] = useState<{ range: string; count: number; color: string }[]>([]);

  useEffect(() => {
    fetchRiskDistribution().then(setData).catch(() => {});
    const interval = setInterval(() => {
      fetchRiskDistribution().then(setData).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-[#0f172a] border border-slate-800 border-t-sky-500/20 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[#64748b] font-semibold uppercase tracking-wider">Risk Distribution</span>
      </div>
      <div className="flex items-end gap-2 h-20">
        {data.map((d) => {
          const maxCount = Math.max(...data.map((x) => x.count));
          const height = (d.count / maxCount) * 100;
          return (
            <div key={d.range} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] font-mono text-[#64748b]">{d.count}</span>
              <div
                className="w-full rounded-t-sm transition-all duration-500"
                style={{ height: `${height}%`, backgroundColor: d.color, minHeight: 4 }}
              />
              <span className="text-[9px] text-[#64748b]">{d.range}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
