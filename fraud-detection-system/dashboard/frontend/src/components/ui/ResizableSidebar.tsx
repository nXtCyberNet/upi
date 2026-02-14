"use client";

import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";

interface ResizableSidebarProps {
  children: ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  side?: "left" | "right";
  className?: string;
}

export function ResizableSidebar({
  children,
  defaultWidth = 380,
  minWidth = 280,
  maxWidth = 640,
  side = "right",
  className = "",
}: ResizableSidebarProps) {
  const [width, setWidth] = useState(defaultWidth);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = side === "right"
        ? startX.current - e.clientX
        : e.clientX - startX.current;
      const next = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta));
      setWidth(next);
    };

    const onMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [minWidth, maxWidth, side]);

  const handle = (
    <div
      onMouseDown={onMouseDown}
      className={`absolute top-0 bottom-0 w-1.5 z-20 cursor-col-resize group
        ${side === "right" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`}
    >
      {/* Visible drag line */}
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] bg-slate-800 group-hover:bg-sky-500/50 transition-colors" />
      {/* Wider hitbox */}
      <div className="absolute inset-y-0 -left-1.5 w-4" />
      {/* Center grip dots */}
      <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="w-1 h-1 rounded-full bg-sky-400/60" />
        <div className="w-1 h-1 rounded-full bg-sky-400/60" />
        <div className="w-1 h-1 rounded-full bg-sky-400/60" />
      </div>
    </div>
  );

  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{ width }}
    >
      {handle}
      <div className="h-full overflow-y-auto overflow-x-hidden">
        {children}
      </div>
    </div>
  );
}
