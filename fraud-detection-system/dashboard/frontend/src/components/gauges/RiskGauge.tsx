"use client";

import { useRef, useEffect } from "react";
import { getRiskColor } from "@/lib/utils";

interface RiskGaugeProps {
  value: number; // 0-100
  size?: number;
  label?: string;
}

export function RiskGauge({ value, size = 200, label = "GLOBAL THREAT" }: RiskGaugeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animatedValue = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    let frameId: number;
    const targetValue = Math.min(100, Math.max(0, value));

    function draw() {
      if (!ctx) return;
      // Smooth interpolation
      animatedValue.current += (targetValue - animatedValue.current) * 0.08;
      const v = animatedValue.current;

      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const radius = size * 0.38;
      const lineWidth = size * 0.06;
      const startAngle = Math.PI * 0.75;
      const endAngle = Math.PI * 2.25;
      const sweepAngle = endAngle - startAngle;

      // Background arc
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.stroke();

      // Value arc
      const valueAngle = startAngle + (v / 100) * sweepAngle;
      const color = getRiskColor(v);

      // Glow
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, valueAngle);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.restore();

      // Center text
      ctx.fillStyle = color;
      ctx.font = `bold ${size * 0.18}px 'JetBrains Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(Math.round(v).toString(), cx, cy - size * 0.02);

      // Label
      ctx.fillStyle = "#64748b";
      ctx.font = `500 ${size * 0.055}px 'Inter', sans-serif`;
      ctx.fillText(label, cx, cy + size * 0.15);

      // Tick marks
      for (let i = 0; i <= 10; i++) {
        const angle = startAngle + (i / 10) * sweepAngle;
        const innerR = radius + lineWidth * 0.8;
        const outerR = radius + lineWidth * 1.3;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
        ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
        ctx.strokeStyle = i * 10 <= v ? color : "#334155";
        ctx.lineWidth = i % 5 === 0 ? 2 : 1;
        ctx.stroke();
      }

      if (Math.abs(v - targetValue) > 0.1) {
        frameId = requestAnimationFrame(draw);
      }
    }

    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, [value, size, label]);

  return (
    <div className="gauge-container flex items-center justify-center">
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
      />
    </div>
  );
}
