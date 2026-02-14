"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import type { Transaction } from "@/lib/types";

interface ContextMenuAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  divider?: boolean;
}

interface TransactionContextMenuProps {
  x: number;
  y: number;
  transaction: Transaction;
  onClose: () => void;
  onFullAnalysis: (tx: Transaction) => void;
  onInspectGraph?: (tx: Transaction) => void;
  extraActions?: ContextMenuAction[];
}

export function TransactionContextMenu({
  x, y, transaction, onClose, onFullAnalysis, onInspectGraph, extraActions,
}: TransactionContextMenuProps) {
  // Close on click outside or escape
  useEffect(() => {
    const handleClick = () => onClose();
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Adjust position to keep menu on screen
  const menuWidth = 240;
  const menuHeight = 260;
  const adjustedX = x + menuWidth > window.innerWidth ? x - menuWidth : x;
  const adjustedY = y + menuHeight > window.innerHeight ? y - menuHeight : y;

  const riskColor = transaction.riskScore >= 80 ? "#ef4444"
    : transaction.riskScore >= 60 ? "#f59e0b"
    : transaction.riskScore >= 40 ? "#38bdf8"
    : "#10b981";

  return (
    <div
      className="fixed z-[100] animate-in fade-in zoom-in-95 duration-100"
      style={{ left: adjustedX, top: adjustedY }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="w-60 bg-[#0f172a] border border-slate-700 rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden backdrop-blur-sm">
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-slate-800 bg-[#020617]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-[#64748b]">{transaction.id.slice(0, 20)}…</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: riskColor + "20", color: riskColor, border: `1px solid ${riskColor}40` }}>
              {transaction.riskScore}
            </span>
          </div>
          <div className="text-[11px] text-[#94a3b8] mt-0.5 font-mono">
            {transaction.senderName} → {transaction.receiverName}
          </div>
        </div>

        {/* Actions */}
        <div className="py-1">
          <CtxMenuItem
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>}
            label="Full Deep Analysis"
            description="Complete transaction breakdown"
            onClick={() => { onFullAnalysis(transaction); onClose(); }}
            highlight
          />
          {onInspectGraph && (
            <CtxMenuItem
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>}
              label="Inspect in Graph"
              description="View network topology"
              onClick={() => { onInspectGraph(transaction); onClose(); }}
            />
          )}
          <CtxMenuItem
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>}
            label="Copy Transaction ID"
            description={transaction.id.slice(0, 24)}
            onClick={() => { navigator.clipboard.writeText(transaction.id); onClose(); }}
          />

          {/* Divider */}
          <div className="my-1 mx-3 h-px bg-slate-800" />

          <CtxMenuItem
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
            label="Flag for Review"
            description="Add to manual review queue"
            onClick={onClose}
          />
          <CtxMenuItem
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>}
            label="Block Sender"
            description={transaction.senderUPI || "unknown"}
            onClick={onClose}
            danger
          />

          {extraActions?.map((action, i) => (
            <CtxMenuItem
              key={i}
              icon={action.icon}
              label={action.label}
              onClick={() => { action.onClick(); onClose(); }}
              danger={action.danger}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CtxMenuItem({ icon, label, description, onClick, danger, highlight }: {
  icon?: ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
  danger?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors
        ${danger
          ? "text-red-400 hover:bg-red-500/10"
          : highlight
            ? "text-sky-300 hover:bg-sky-500/10"
            : "text-[#94a3b8] hover:bg-[#1e293b]"
        }`}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">
        <div className={`text-xs font-medium ${highlight ? "text-sky-300" : danger ? "text-red-400" : "text-[#f1f5f9]"}`}>
          {label}
        </div>
        {description && (
          <div className="text-[10px] text-[#475569] font-mono truncate mt-0.5">
            {description}
          </div>
        )}
      </div>
    </button>
  );
}

// ── Hook for context menu state ──────────────────────────────
export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    transaction: Transaction;
  } | null>(null);

  const showContextMenu = useCallback(
    (e: React.MouseEvent, tx: Transaction) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, transaction: tx });
    },
    []
  );

  const hideContextMenu = useCallback(() => setContextMenu(null), []);

  return { contextMenu, showContextMenu, hideContextMenu };
}
