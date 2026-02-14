"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { RiskFilterMode } from "@/hooks/useFilteredTransactions";
import { ShieldAlert, AlertTriangle, TrendingDown, Layers, Flag } from "lucide-react";

interface TransactionFilterProps {
  filterMode: RiskFilterMode;
  onFilterChange: (mode: RiskFilterMode) => void;
  counts: {
    flagged: number;
    high: number;
    medium: number;
    normal: number;
    all: number;
  };
  isDebouncing?: boolean;
}

const FILTER_OPTIONS: {
  key: RiskFilterMode;
  label: string;
  shortcut: string;
  color: string;
  glowColor: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    key: "flagged",
    label: "Flagged",
    shortcut: "F",
    color: "#f59e0b",
    glowColor: "rgba(245, 158, 11, 0.15)",
    icon: <Flag size={11} />,
    description: "Risk ≥ 40",
  },
  {
    key: "high",
    label: "High",
    shortcut: "1",
    color: "#ef4444",
    glowColor: "rgba(239, 68, 68, 0.15)",
    icon: <ShieldAlert size={11} />,
    description: "Risk ≥ 60",
  },
  {
    key: "medium",
    label: "Medium",
    shortcut: "2",
    color: "#38bdf8",
    glowColor: "rgba(56, 189, 248, 0.15)",
    icon: <AlertTriangle size={11} />,
    description: "Risk 40–59",
  },
  {
    key: "normal",
    label: "Normal",
    shortcut: "3",
    color: "#10b981",
    glowColor: "rgba(16, 185, 129, 0.15)",
    icon: <TrendingDown size={11} />,
    description: "Risk < 40",
  },
  {
    key: "all",
    label: "All",
    shortcut: "A",
    color: "#94a3b8",
    glowColor: "rgba(148, 163, 184, 0.1)",
    icon: <Layers size={11} />,
    description: "Everything",
  },
];

export function TransactionFilter({
  filterMode,
  onFilterChange,
  counts,
  isDebouncing,
}: TransactionFilterProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* Filter pills row */}
      <div className="flex items-center gap-1 flex-wrap">
        <AnimatePresence mode="sync">
          {FILTER_OPTIONS.map((opt) => {
            const isActive = filterMode === opt.key;
            const count = counts[opt.key];

            return (
              <motion.button
                key={opt.key}
                onClick={() => onFilterChange(opt.key)}
                layout
                className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors duration-200 ${
                  isActive
                    ? "text-[#f1f5f9] border-opacity-50"
                    : "text-[#64748b] border-transparent hover:text-[#94a3b8] hover:bg-[#0f172a]"
                }`}
                style={
                  isActive
                    ? {
                        backgroundColor: opt.glowColor,
                        borderColor: `${opt.color}50`,
                        boxShadow: `0 0 12px ${opt.glowColor}`,
                      }
                    : undefined
                }
                title={`${opt.description} (${opt.shortcut})`}
              >
                {/* Active indicator underline */}
                {isActive && (
                  <motion.div
                    layoutId="filter-active-bg"
                    className="absolute inset-0 rounded-lg"
                    style={{
                      backgroundColor: opt.glowColor,
                      border: `1px solid ${opt.color}30`,
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}

                <span className="relative flex items-center gap-1.5">
                  <span style={{ color: isActive ? opt.color : undefined }}>{opt.icon}</span>
                  {opt.label}
                  <span
                    className="font-mono text-[9px] px-1 py-0.5 rounded"
                    style={{
                      backgroundColor: isActive ? `${opt.color}20` : "transparent",
                      color: isActive ? opt.color : "#475569",
                    }}
                  >
                    {count}
                  </span>
                  {/* Keyboard shortcut hint */}
                  <span className="text-[8px] text-[#334155] font-mono hidden sm:inline">
                    {opt.shortcut}
                  </span>
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Debounce indicator */}
      {isDebouncing && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="flex items-center gap-1.5 px-2 text-[9px] font-mono text-[#475569]"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400/60 animate-pulse" />
          Updating filter…
        </motion.div>
      )}
    </div>
  );
}
