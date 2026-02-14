"use client";

import { useState, useEffect, useRef } from "react";

interface SemanticAlertProps {
  alert: string;
}

export function SemanticAlert({ alert }: SemanticAlertProps) {
  const [displayText, setDisplayText] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const prevAlertRef = useRef("");

  useEffect(() => {
    if (!alert || alert === prevAlertRef.current) return;
    prevAlertRef.current = alert;
    setIsComplete(false);
    setDisplayText("");

    let i = 0;
    const speed = 18; // ms per character
    const interval = setInterval(() => {
      if (i < alert.length) {
        setDisplayText(alert.slice(0, i + 1));
        i++;
      } else {
        setIsComplete(true);
        clearInterval(interval);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [alert]);

  if (!alert) return null;

  // Split and colorize segments
  const renderColorized = (text: string) => {
    const segments = text.split(" | ");
    return segments.map((seg, i) => {
      // Determine color based on keywords
      let color = "#94a3b8";
      if (seg.includes("ALERT:")) color = "#ef4444";
      else if (seg.includes("Geo-Jump") || seg.includes("Impossible")) color = "#f59e0b";
      else if (seg.includes("Cycle") || seg.includes("Hop")) color = "#a78bfa";
      else if (seg.includes("Device") || seg.includes("Multiplexing")) color = "#22d3ee";
      else if (seg.includes("Phishing") || seg.includes("VPA")) color = "#ef4444";
      else if (seg.includes("Expected") || seg.includes("Actual")) color = "#f59e0b";
      else if (seg.includes("Z-Score") || seg.includes("temporal")) color = "#38bdf8";

      return (
        <span key={i}>
          {i > 0 && <span className="text-[#334155] mx-1">|</span>}
          <span style={{ color }}>{seg.replace("ALERT: ", "")}</span>
        </span>
      );
    });
  };

  return (
    <div className="bg-[#020617] rounded-xl border border-[#1e293b] p-3 relative overflow-hidden">
      {/* Scanning bar animation behind text */}
      {!isComplete && (
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute top-0 bottom-0 w-8 bg-gradient-to-r from-transparent via-[#38bdf820] to-transparent"
            style={{
              animation: "scanline 2s linear infinite",
              left: `${(displayText.length / (alert.length || 1)) * 100}%`,
            }}
          />
        </div>
      )}

      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5">
          <span className={`inline-block w-2 h-2 rounded-full ${isComplete ? "bg-[#ef4444]" : "bg-[#f59e0b] animate-pulse"}`} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] text-[#64748b] uppercase tracking-wider font-semibold mb-1">
            Semantic Explainability
          </div>
          <div className="font-mono text-[11px] leading-relaxed break-words">
            <span className="text-[#ef4444] font-bold">ALERT: </span>
            {isComplete ? renderColorized(displayText) : (
              <>
                <span className="text-[#94a3b8]">{displayText.replace("ALERT: ", "")}</span>
                <span className="inline-block w-[2px] h-3 bg-[#38bdf8] ml-0.5 animate-pulse" />
              </>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes scanline {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
