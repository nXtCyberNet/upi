"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { formatINR, getRiskColor, getRiskBadgeClass, getRiskLabel } from "@/lib/utils";
import type { Transaction } from "@/lib/types";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Pause, Play, ShieldOff, ArrowDown } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useFilteredTransactions } from "@/hooks/useFilteredTransactions";
import { TransactionFilter } from "./TransactionFilter";

interface TransactionStreamProps {
  transactions: Transaction[];
  onSelect: (tx: Transaction) => void;
  selectedId?: string;
  onContextMenu?: (e: React.MouseEvent, tx: Transaction) => void;
}

// ── Virtual scrolling threshold ──────────────────────────────
const VIRTUAL_THRESHOLD = 100;

export function TransactionStream({ transactions, onSelect, selectedId, onContextMenu }: TransactionStreamProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isFrozen, setIsFrozen] = useState(false);

  // ── Risk-based filtering (LRU buffer, debounce, keyboard, localStorage) ──
  const {
    filterMode,
    setFilterMode,
    filteredTransactions: riskFilteredTxs,
    counts,
    isDebouncing,
  } = useFilteredTransactions(transactions);

  // Freeze snapshot: when user hovers or explicitly freezes, we capture the
  // current list so new incoming txs don't shift items under the cursor
  const frozenTxRef = useRef<Transaction[]>([]);
  const displayFrozen = isHovering || isFrozen;

  const handleMouseEnter = useCallback(() => {
    frozenTxRef.current = riskFilteredTxs;
    setIsHovering(true);
  }, [riskFilteredTxs]);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
  }, []);

  // Use frozen snapshot when hovering, live data otherwise
  const baseTxList = displayFrozen ? frozenTxRef.current : riskFilteredTxs;

  // Apply search filter on top of risk filter
  const filteredTxs = useMemo(() => {
    let list = baseTxList;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((tx) =>
        (tx.senderUPI || "").toLowerCase().includes(q) ||
        (tx.receiverUPI || "").toLowerCase().includes(q) ||
        (tx.senderName || "").toLowerCase().includes(q) ||
        (tx.receiverName || "").toLowerCase().includes(q) ||
        (tx.city || "").toLowerCase().includes(q) ||
        (tx.id || "").toLowerCase().includes(q) ||
        String(tx.amount || 0).includes(q)
      );
    }

    return list;
  }, [baseTxList, searchQuery]);

  // Pin selected tx to top if it exists and isn't already in filtered list
  const selectedTx = selectedId ? baseTxList.find((tx) => tx.id === selectedId) : null;
  const pinnedAtTop = selectedTx && filteredTxs[0]?.id !== selectedId;

  // ── Virtual scrolling (only when >100 items) ──────────────
  const useVirtual = filteredTxs.length > VIRTUAL_THRESHOLD;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredTxs.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 60, // approx row height in px
    overscan: 10,
    enabled: useVirtual,
  });

  // ── Empty state messages per filter ───────────────────────
  const emptyMessage = useMemo(() => {
    if (searchQuery.trim()) return "No transactions match your search";
    switch (filterMode) {
      case "normal":
        return "No normal transactions in the buffer. All recent transactions have elevated risk scores.";
      case "high":
        return "No high-risk transactions detected. The system is operating normally.";
      case "medium":
        return "No medium-risk transactions in the current window.";
      case "flagged":
        return "No flagged transactions. All recent activity appears normal.";
      default:
        return "No transactions available";
    }
  }, [filterMode, searchQuery]);

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* ── Controls Bar ── */}
      <div className="flex flex-col gap-1.5 shrink-0">
        {/* Search + Freeze */}
        <div className="flex items-center gap-1.5">
          <div className="flex-1 relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#64748b]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search UPI, name, city…"
              className="w-full pl-7 pr-3 py-1.5 rounded-lg text-[11px] bg-[#0f172a] border border-[#1e293b] text-[#f1f5f9] placeholder-[#475569] focus:border-sky-500/40 focus:outline-none focus:shadow-[0_0_8px_rgba(56,189,248,0.1)] transition-all font-mono"
            />
          </div>
          <button
            onClick={() => setIsFrozen(!isFrozen)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-all ${
              isFrozen
                ? "bg-amber-500/15 text-amber-400 border-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.1)]"
                : "bg-[#0f172a] text-[#64748b] border-[#1e293b] hover:text-[#94a3b8] hover:border-[#334155]"
            }`}
            title={isFrozen ? "Resume live updates" : "Freeze stream to browse"}
          >
            {isFrozen ? <Play size={10} /> : <Pause size={10} />}
            {isFrozen ? "LIVE" : "FREEZE"}
          </button>
        </div>

        {/* Risk filter pills (always visible) */}
        <TransactionFilter
          filterMode={filterMode}
          onFilterChange={setFilterMode}
          counts={counts}
          isDebouncing={isDebouncing}
        />

        {/* Status bar */}
        <div className="flex items-center justify-between text-[9px] font-mono px-1">
          <span className="text-[#475569]">
            {filteredTxs.length} shown · {counts.all} buffered
            {useVirtual && (
              <span className="text-sky-400/50 ml-1">· virtual</span>
            )}
          </span>
          <span className="flex items-center gap-2">
            {displayFrozen && (
              <span className="text-amber-400/80 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                {isFrozen ? "FROZEN" : "HOVER-PAUSED"}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* ── Transaction List ── */}
      <div
        ref={scrollContainerRef}
        className="flex flex-col flex-1 overflow-y-auto pr-1 min-h-0"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Pinned selected tx */}
        {pinnedAtTop && selectedTx && (
          <div className="shrink-0 mb-1">
            <div className="text-[9px] text-sky-400/60 font-mono px-1 mb-0.5 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-sky-400" />
              PINNED SELECTION
            </div>
            <TxRow tx={selectedTx} isSelected onSelect={onSelect} onContextMenu={onContextMenu} />
          </div>
        )}

        {/* Virtual scrolling for large lists */}
        {useVirtual ? (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const tx = filteredTxs[virtualRow.index];
              if (!tx) return null;
              return (
                <div
                  key={tx.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="pb-1"
                >
                  <TxRow
                    tx={tx}
                    isSelected={selectedId === tx.id}
                    onSelect={onSelect}
                    onContextMenu={onContextMenu}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          /* Normal animated list for smaller sets */
          <div className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {filteredTxs.map((tx) => (
                <motion.div
                  key={tx.id}
                  initial={displayFrozen ? false : { opacity: 0, x: -20, height: 0 }}
                  animate={{ opacity: 1, x: 0, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: displayFrozen ? 0 : 0.2 }}
                >
                  <TxRow
                    tx={tx}
                    isSelected={selectedId === tx.id}
                    onSelect={onSelect}
                    onContextMenu={onContextMenu}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* ── Empty States ── */}
        {filteredTxs.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center justify-center py-10 text-[#64748b] gap-3"
          >
            {filterMode === "normal" ? (
              <ShieldOff size={28} className="opacity-30 text-emerald-500/40" />
            ) : (
              <Search size={24} className="opacity-30" />
            )}
            <div className="text-center px-4">
              <p className="text-xs font-medium text-[#94a3b8] mb-1">
                {filterMode === "normal" ? "No Normal Transactions" : "No Results"}
              </p>
              <p className="text-[10px] text-[#475569] leading-relaxed max-w-[220px]">
                {emptyMessage}
              </p>
            </div>
            {filterMode !== "all" && filterMode !== "flagged" && (
              <button
                onClick={() => setFilterMode("flagged")}
                className="flex items-center gap-1 px-3 py-1.5 mt-1 rounded-lg text-[10px] font-semibold bg-[#0f172a] border border-[#1e293b] text-[#64748b] hover:text-[#94a3b8] hover:border-[#334155] transition-all"
              >
                <ArrowDown size={10} />
                Show flagged instead
              </button>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ── Individual Transaction Row ───────────────────────────────
function TxRow({ tx, isSelected, onSelect, onContextMenu }: {
  tx: Transaction;
  isSelected: boolean;
  onSelect: (tx: Transaction) => void;
  onContextMenu?: (e: React.MouseEvent, tx: Transaction) => void;
}) {
  return (
    <div
      onClick={() => onSelect(tx)}
      onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); onContextMenu(e, tx); } }}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150 border
        ${isSelected
          ? "bg-[#1e293b] border-slate-700 border-t-sky-500/20"
          : "bg-[#0f172a]/60 border-transparent hover:bg-[#0f172a] hover:border-slate-800"
        }`}
      style={
        tx.riskScore >= 80
          ? { boxShadow: "0 0 15px rgba(239, 68, 68, 0.15), inset 0 1px 0 rgba(239, 68, 68, 0.08)" }
          : undefined
      }
    >
      {/* Risk indicator dot */}
      <div
        className={`w-2 h-2 rounded-full shrink-0 ${tx.riskScore >= 80 ? "animate-pulse" : ""}`}
        style={{
          backgroundColor: getRiskColor(tx.riskScore),
          boxShadow: tx.riskScore >= 80
            ? `0 0 12px ${getRiskColor(tx.riskScore)}80`
            : `0 0 8px ${getRiskColor(tx.riskScore)}60`,
        }}
      />

      {/* Transaction details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-[#94a3b8] truncate">{(tx.senderUPI || "unknown").split("@")[0].slice(0, 6)}…</span>
          <span className="text-[#64748b]">→</span>
          <span className="font-mono text-[#94a3b8] truncate">{(tx.receiverUPI || "unknown").split("@")[0].slice(0, 6)}…</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-[#64748b]">{tx.city || "—"}</span>
          <span className="text-xs text-[#334155]">•</span>
          <span className="text-xs font-mono text-[#64748b]">{tx.latencyMs ?? 0}ms</span>
        </div>
      </div>

      {/* Amount */}
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold font-mono" style={{ color: getRiskColor(tx.riskScore) }}>
          {formatINR(tx.amount)}
        </div>
        <div className="flex items-center justify-end gap-1 mt-0.5">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${getRiskBadgeClass(tx.riskScore)}`}>
            {getRiskLabel(tx.riskScore)} {tx.riskScore}
          </span>
          {tx.status === "BLOCKED" && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
              BLOCKED
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
