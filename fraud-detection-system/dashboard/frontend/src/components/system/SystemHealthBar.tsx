"use client";

import type { SystemHealth } from "@/lib/types";
import { Database, HardDrive, Cpu, Clock, GitBranch, Activity, Zap } from "lucide-react";

interface SystemHealthBarProps {
  health: SystemHealth;
  wsConnected?: boolean;
}

/* thin vertical divider between groups */
function Sep() {
  return <div className="w-px h-4 bg-slate-700/60 shrink-0" />;
}

/* label in muted color */
function L({ children }: { children: React.ReactNode }) {
  return <span className="text-[#475569]">{children}</span>;
}

export function SystemHealthBar({ health, wsConnected = false }: SystemHealthBarProps) {
  const neo4j = health.neo4j ?? { activeConnections: 0, idleConnections: 0, avgQueryMs: 0, nodesCount: 0, relsCount: 0 };
  const redis = health.redis ?? { lagMs: 0, streamDepth: 0, memoryUsedMB: 0, pendingMessages: 0 };
  const workers = health.workers ?? { active: 0, total: 8, cpuPercent: 0, ramPercent: 0, processedPerSec: 0, wsConnections: 0 };
  const wsCnt = workers.wsConnections ?? 0;
  const ga = health.graphAnalytics;
  const tps = health.tps ?? 0;
  const meanLat = health.meanLatencyMs ?? 0;
  const cpuPct = workers.cpuPercent ?? 0;
  const ramPct = workers.ramPercent ?? 0;
  const isLive = neo4j.nodesCount > 0;

  return (
    <footer className="fixed bottom-0 inset-x-0 z-50 h-8 bg-[#020617]/95 backdrop-blur-sm border-t border-sky-500/10 select-none">
      <div className="h-full flex items-center justify-between px-3 text-[11px] font-mono leading-none whitespace-nowrap overflow-x-auto gap-3">
        {/* ── Left: engine metrics ── */}
        <div className="flex items-center gap-3 shrink-0">
          {/* TPS & Latency */}
          <div className="flex items-center gap-1.5">
            <Zap size={11} className="text-amber-400" />
            <L>TPS</L>
            <span className={tps > 0 ? "text-emerald-400" : "text-slate-500"}>{tps.toFixed(1)}</span>
            <span className="text-slate-700 mx-0.5">·</span>
            <L>Lat</L>
            <span className={meanLat < 100 ? "text-emerald-400" : meanLat < 200 ? "text-amber-400" : "text-red-400"}>
              {meanLat.toFixed(0)}<span className="text-slate-600">ms</span>
            </span>
          </div>

          <Sep />

          {/* Neo4j */}
          <div className="flex items-center gap-1.5">
            <Database size={11} className="text-sky-400" />
            <L>Neo4j</L>
            <span className="text-emerald-400">{neo4j.activeConnections}</span>
            <span className="text-slate-600">/{neo4j.idleConnections + neo4j.activeConnections}</span>
            <span className="text-slate-700 mx-0.5">·</span>
            <span className="text-cyan-400">{neo4j.nodesCount.toLocaleString()}</span>
            <span className="text-slate-600">nodes</span>
            <span className="text-violet-400">{neo4j.relsCount.toLocaleString()}</span>
            <span className="text-slate-600">rels</span>
          </div>

          <Sep />

          {/* Graph Analytics */}
          {ga && ga.clusters > 0 && (
            <>
              <div className="flex items-center gap-1.5">
                <GitBranch size={11} className="text-cyan-400" />
                <L>Mod</L>
                <span className={ga.modularity > 0.5 ? "text-amber-400" : "text-emerald-400"}>
                  {ga.modularity.toFixed(2)}
                </span>
                <span className="text-slate-700 mx-0.5">·</span>
                <span className="text-violet-400">{ga.clusters}</span>
                <span className="text-slate-600">cls</span>
                <span className="text-slate-700 mx-0.5">·</span>
                <L>BFS</L>
                <span className={ga.bfsLatencyMs < 50 ? "text-emerald-400" : ga.bfsLatencyMs < 150 ? "text-amber-400" : "text-red-400"}>
                  {ga.bfsLatencyMs.toFixed(0)}<span className="text-slate-600">ms</span>
                </span>
              </div>
              <Sep />
            </>
          )}

          {/* Redis */}
          <div className="flex items-center gap-1.5">
            <HardDrive size={11} className="text-red-400" />
            <L>Redis</L>
            <span className={redis.lagMs < 5 ? "text-emerald-400" : redis.lagMs < 20 ? "text-amber-400" : "text-red-400"}>
              {redis.lagMs}<span className="text-slate-600">ms</span>
            </span>
            <span className="text-slate-700 mx-0.5">·</span>
            <span className="text-cyan-400">{redis.memoryUsedMB}<span className="text-slate-600">MB</span></span>
            <span className="text-slate-700 mx-0.5">·</span>
            <span className={redis.streamDepth > 10 ? "text-amber-400" : "text-slate-400"}>{redis.streamDepth}</span>
            <span className="text-slate-600">buf</span>
          </div>

          <Sep />

          {/* Workers + CPU/RAM */}
          <div className="flex items-center gap-1.5">
            <Cpu size={11} className="text-violet-400" />
            <L>Workers</L>
            <span className="text-emerald-400">{workers.active}</span>
            <span className="text-slate-600">/{workers.total}</span>
            <span className="text-slate-700 mx-0.5">·</span>
            <L>CPU</L>
            <span className={cpuPct > 50 ? "text-amber-400" : "text-emerald-400"}>{cpuPct.toFixed(0)}%</span>
            <L>RAM</L>
            <span className={ramPct > 50 ? "text-amber-400" : "text-emerald-400"}>{ramPct.toFixed(0)}%</span>
          </div>

          <Sep />

          {/* WebSocket */}
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
            <L>WS</L>
            <span className={wsConnected ? "text-emerald-400" : "text-red-400"}>
              {wsConnected ? `${wsCnt || 1}` : "0"}
            </span>
          </div>
        </div>

        {/* ── Right: status ── */}
        <div className="flex items-center gap-3 shrink-0">
          {workers.processedPerSec > 0 && (
            <span className="text-slate-500">
              <span className="text-emerald-400">{workers.processedPerSec.toFixed(1)}</span> tx/s
            </span>
          )}
          <div className="flex items-center gap-1">
            <Clock size={10} className="text-slate-600" />
            <span className="text-slate-500">{health.uptime || "0h 0m"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity size={10} className={isLive ? "text-emerald-400 animate-pulse" : "text-slate-600"} />
            <span className={isLive ? "text-emerald-400 font-semibold" : "text-red-400"}>
              {isLive ? "LIVE" : "OFFLINE"}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
