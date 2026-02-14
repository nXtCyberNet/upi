import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function getRiskColor(score: number): string {
  if (score >= 80) return "#ef4444";
  if (score >= 60) return "#f59e0b";
  if (score >= 40) return "#38bdf8";
  return "#10b981";
}

export function getRiskLabel(score: number): string {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

export function getRiskBadgeClass(score: number): string {
  if (score >= 80) return "risk-badge-critical";
  if (score >= 60) return "risk-badge-high";
  if (score >= 40) return "risk-badge-medium";
  return "risk-badge-low";
}

export function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}
