"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { Transaction } from "@/lib/types";

// ── Filter categories ────────────────────────────────────────
export type RiskFilterMode = "flagged" | "high" | "medium" | "normal" | "all";

// ── LRU Buffer constants ─────────────────────────────────────
const MAX_FLAGGED = 200;
const MAX_NORMAL = 50;
const RISK_THRESHOLD_FLAGGED = 40; // risk >= 40 considered "flagged"
const DEBOUNCE_MS = 300;
const STORAGE_KEY = "fraud-dashboard-risk-filter";

// ── Helpers ──────────────────────────────────────────────────

function classifyRisk(score: number): "high" | "medium" | "normal" {
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  return "normal";
}

function readStoredFilter(): RiskFilterMode {
  if (typeof window === "undefined") return "flagged";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ["flagged", "high", "medium", "normal", "all"].includes(stored)) {
      return stored as RiskFilterMode;
    }
  } catch {
    // localStorage may throw in some environments
  }
  return "flagged";
}

function writeStoredFilter(mode: RiskFilterMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // silently ignore
  }
}

// ══════════════════════════════════════════════════════════════
// useFilteredTransactions — LRU buffer + debounced filtering
// ══════════════════════════════════════════════════════════════

export function useFilteredTransactions(allTransactions: Transaction[]) {
  const [filterMode, setFilterModeRaw] = useState<RiskFilterMode>(readStoredFilter);

  // Debounce state: the "committed" filter that actually drives filtering
  const [debouncedMode, setDebouncedMode] = useState<RiskFilterMode>(filterMode);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist + debounce filter changes
  const setFilterMode = useCallback((mode: RiskFilterMode) => {
    setFilterModeRaw(mode);
    writeStoredFilter(mode);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedMode(mode);
    }, DEBOUNCE_MS);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── LRU Buffer: split incoming txs into flagged (risk>=40) and normal ──
  const { flaggedBuffer, normalBuffer } = useMemo(() => {
    const flagged: Transaction[] = [];
    const normal: Transaction[] = [];

    for (const tx of allTransactions) {
      if (tx.riskScore >= RISK_THRESHOLD_FLAGGED) {
        if (flagged.length < MAX_FLAGGED) flagged.push(tx);
      } else {
        if (normal.length < MAX_NORMAL) normal.push(tx);
      }
      // Stop early once both buffers are full
      if (flagged.length >= MAX_FLAGGED && normal.length >= MAX_NORMAL) break;
    }

    return { flaggedBuffer: flagged, normalBuffer: normal };
  }, [allTransactions]);

  // ── Apply the active filter ────────────────────────────────
  const filteredTransactions = useMemo(() => {
    switch (debouncedMode) {
      case "flagged":
        return flaggedBuffer;
      case "high":
        return flaggedBuffer.filter((tx) => tx.riskScore >= 60);
      case "medium":
        return flaggedBuffer.filter(
          (tx) => tx.riskScore >= 40 && tx.riskScore < 60
        );
      case "normal":
        return normalBuffer;
      case "all":
        // Merge preserving timestamp order (both are already sorted newest-first)
        return [...flaggedBuffer, ...normalBuffer]
          .sort((a, b) => {
            const ta = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
            const tb = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
            return tb - ta;
          })
          .slice(0, MAX_FLAGGED + MAX_NORMAL);
      default:
        return flaggedBuffer;
    }
  }, [debouncedMode, flaggedBuffer, normalBuffer]);

  // ── Counts for badges ──────────────────────────────────────
  const counts = useMemo(
    () => ({
      flagged: flaggedBuffer.length,
      high: flaggedBuffer.filter((tx) => tx.riskScore >= 60).length,
      medium: flaggedBuffer.filter(
        (tx) => tx.riskScore >= 40 && tx.riskScore < 60
      ).length,
      normal: normalBuffer.length,
      all: flaggedBuffer.length + normalBuffer.length,
    }),
    [flaggedBuffer, normalBuffer]
  );

  // ── Keyboard shortcuts ─────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case "1":
          setFilterMode("high");
          break;
        case "2":
          setFilterMode("medium");
          break;
        case "3":
          setFilterMode("normal");
          break;
        case "a":
        case "A":
          setFilterMode("all");
          break;
        case "f":
        case "F":
          setFilterMode("flagged");
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setFilterMode]);

  return {
    filterMode,
    setFilterMode,
    filteredTransactions,
    counts,
    isDebouncing: filterMode !== debouncedMode,
  };
}
