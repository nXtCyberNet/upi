"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoEvidence } from "@/lib/types";

interface GeodesicArcMapProps {
  evidence: GeoEvidence;
}

// ── Great-circle intermediate points (geodesic arc) ──────────
function interpolateGreatCircle(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  steps: number
): [number, number][] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const phi1 = toRad(lat1), lam1 = toRad(lon1);
  const phi2 = toRad(lat2), lam2 = toRad(lon2);

  const d = 2 * Math.asin(
    Math.sqrt(
      Math.sin((phi2 - phi1) / 2) ** 2 +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2
    )
  );

  if (d < 1e-10) return [[lat1, lon1], [lat2, lon2]];

  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
    const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);
    points.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }
  return points;
}

export function GeodesicArcMap({ evidence }: GeodesicArcMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [leafletReady, setLeafletReady] = useState(false);

  const isImpossible = evidence.speedKmh > 250;
  const arcColor = isImpossible ? "#ef4444" : evidence.speedKmh > 100 ? "#f59e0b" : "#10b981";
  const speedColor = isImpossible ? "#fca5a5" : "#fbbf24";

  useEffect(() => {
    if (!mapContainerRef.current) return;
    // Prevent double init
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    let cancelled = false;

    (async () => {
      // Dynamic import for SSR safety — Leaflet requires window
      const L = (await import("leaflet")).default;

      if (cancelled || !mapContainerRef.current) return;

      const dLat = evidence.deviceGeo.lat;
      const dLng = evidence.deviceGeo.lng;
      const iLat = evidence.ipGeo.lat;
      const iLng = evidence.ipGeo.lng;

      const centerLat = (dLat + iLat) / 2;
      const centerLng = (dLng + iLng) / 2;

      // Auto-zoom to fit both points
      const latDiff = Math.abs(dLat - iLat);
      const lngDiff = Math.abs(dLng - iLng);
      const maxDiff = Math.max(latDiff, lngDiff);
      let zoom = 5;
      if (maxDiff < 1) zoom = 10;
      else if (maxDiff < 3) zoom = 8;
      else if (maxDiff < 6) zoom = 7;
      else if (maxDiff < 10) zoom = 6;

      const map = L.map(mapContainerRef.current, {
        center: [centerLat, centerLng],
        zoom,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false,
      });

      mapInstanceRef.current = map;

      // ── CartoDB DarkMatter tile layer ───────────────────────
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(map);

      // ── Geodesic arc polyline ──────────────────────────────
      const arcPoints = interpolateGreatCircle(dLat, dLng, iLat, iLng, 50);
      const arcLatLngs = arcPoints.map(([lat, lng]) => L.latLng(lat, lng));

      // Glow layer (wider, lower opacity)
      L.polyline(arcLatLngs, {
        color: arcColor,
        weight: isImpossible ? 6 : 3,
        opacity: 0.2,
        smoothFactor: 1,
        lineCap: "round",
      }).addTo(map);

      // Main arc
      L.polyline(arcLatLngs, {
        color: arcColor,
        weight: isImpossible ? 3 : 1.5,
        opacity: 0.8,
        dashArray: isImpossible ? undefined : "8 6",
        smoothFactor: 1,
        lineCap: "round",
      }).addTo(map);

      // Marching-ants overlay
      L.polyline(arcLatLngs, {
        color: arcColor,
        weight: 2,
        opacity: 0.6,
        dashArray: "4 12",
        smoothFactor: 1,
        lineCap: "round",
        className: "leaflet-arc-marching",
      }).addTo(map);

      // ── Custom glowing circle markers ──────────────────────
      const deviceIcon = L.divIcon({
        className: "custom-marker",
        html: `
          <div style="position:relative;width:32px;height:32px;">
            <div style="position:absolute;inset:0;border-radius:50%;background:rgba(16,185,129,0.15);animation:pulse-ring 2s ease-out infinite;"></div>
            <div style="position:absolute;inset:6px;border-radius:50%;background:#10b981;border:2px solid #020617;box-shadow:0 0 12px rgba(16,185,129,0.6);"></div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const ipMarkerColor = isImpossible ? "#ef4444" : "#f59e0b";
      const ipIcon = L.divIcon({
        className: "custom-marker",
        html: `
          <div style="position:relative;width:32px;height:32px;">
            <div style="position:absolute;inset:0;border-radius:50%;background:rgba(${isImpossible ? "239,68,68" : "245,158,11"},0.15);animation:pulse-ring 2s ease-out infinite;"></div>
            <div style="position:absolute;inset:6px;border-radius:50%;background:${ipMarkerColor};border:2px solid #020617;box-shadow:0 0 12px rgba(${isImpossible ? "239,68,68" : "245,158,11"},0.6);"></div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      // Device GPS marker
      L.marker([dLat, dLng], { icon: deviceIcon })
        .addTo(map)
        .bindTooltip(
          `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#f1f5f9;background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:8px 10px;box-shadow:0 4px 20px rgba(0,0,0,0.5);">
            <div style="color:#10b981;font-weight:700;margin-bottom:3px;">📍 Device GPS</div>
            <div>${evidence.deviceGeo.city}</div>
            <div style="color:#64748b;font-size:9px;">${dLat.toFixed(4)}°N, ${dLng.toFixed(4)}°E</div>
          </div>`,
          { permanent: true, direction: "top", offset: [0, -20], className: "leaflet-tooltip-dark" }
        );

      // IP location marker
      L.marker([iLat, iLng], { icon: ipIcon })
        .addTo(map)
        .bindTooltip(
          `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#f1f5f9;background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:8px 10px;box-shadow:0 4px 20px rgba(0,0,0,0.5);">
            <div style="color:${ipMarkerColor};font-weight:700;margin-bottom:3px;">🌐 IP Location</div>
            <div>${evidence.ipGeo.city}</div>
            <div style="color:#64748b;font-size:9px;">${iLat.toFixed(4)}°N, ${iLng.toFixed(4)}°E</div>
          </div>`,
          { permanent: true, direction: "top", offset: [0, -20], className: "leaflet-tooltip-dark" }
        );

      // ── Speed label at arc midpoint ────────────────────────
      const midIdx = Math.floor(arcPoints.length / 2);
      const midPt = arcPoints[midIdx];
      const speedDivIcon = L.divIcon({
        className: "speed-label",
        html: `
          <div style="
            font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;
            color:${speedColor};background:#0f172aee;border:1px solid ${arcColor}60;
            border-radius:6px;padding:4px 10px;white-space:nowrap;
            box-shadow:0 0 15px ${arcColor}30;text-align:center;
          ">
            ${evidence.speedKmh.toLocaleString()} km/h
            <div style="font-size:8px;color:#64748b;font-weight:400;">${evidence.distanceKm.toLocaleString()} km in ${evidence.timeDeltaMin}min</div>
          </div>
        `,
        iconSize: [120, 36],
        iconAnchor: [60, 18],
      });
      L.marker(midPt, { icon: speedDivIcon, interactive: false }).addTo(map);

      // Fit bounds with padding
      const bounds = L.latLngBounds([L.latLng(dLat, dLng), L.latLng(iLat, iLng)]);
      map.fitBounds(bounds.pad(0.3));

      setLeafletReady(true);
    })();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidence.deviceGeo.lat, evidence.deviceGeo.lng, evidence.ipGeo.lat, evidence.ipGeo.lng]);

  return (
    <div className="bg-[#020617] rounded-xl border border-[#1e293b] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className="text-[10px] text-[#64748b] uppercase tracking-wider font-semibold">
            Geodesic Arc — Impossible Travel Evidence
          </p>
          <span className="text-[9px] font-mono text-sky-400/50">Leaflet + CartoDB DarkMatter</span>
        </div>
        {isImpossible && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30 animate-pulse">
            ⚠ IMPOSSIBLE TRAVEL
          </span>
        )}
      </div>

      {/* Map container */}
      <div className="h-64 rounded-lg relative overflow-hidden border border-[#1e293b]">
        <div ref={mapContainerRef} className="absolute inset-0 z-0" />
        {!leafletReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0f1e] z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-[10px] font-mono text-[#64748b]">Loading map tiles…</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom stats */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="bg-[#0f172a] rounded-lg p-2 text-center">
          <div className="text-[10px] text-[#64748b]">Distance</div>
          <div className="text-sm font-bold font-mono text-[#f59e0b]">{evidence.distanceKm.toLocaleString()} km</div>
        </div>
        <div className="bg-[#0f172a] rounded-lg p-2 text-center">
          <div className="text-[10px] text-[#64748b]">Speed</div>
          <div className={`text-sm font-bold font-mono ${isImpossible ? "text-[#ef4444]" : "text-[#10b981]"}`}>
            {evidence.speedKmh.toLocaleString()} km/h
          </div>
        </div>
        <div className="bg-[#0f172a] rounded-lg p-2 text-center">
          <div className="text-[10px] text-[#64748b]">Time Delta</div>
          <div className="text-sm font-bold font-mono text-[#38bdf8]">{evidence.timeDeltaMin} min</div>
        </div>
      </div>

      {/* Leaflet dark-theme overrides + animations */}
      <style jsx global>{`
        .leaflet-tooltip-dark {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        .leaflet-tooltip-dark::before {
          display: none !important;
        }
        .custom-marker {
          background: transparent !important;
          border: none !important;
        }
        .speed-label {
          background: transparent !important;
          border: none !important;
        }
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes march {
          to { stroke-dashoffset: -32; }
        }
        .leaflet-arc-marching {
          animation: march 1s linear infinite;
        }
        .leaflet-container {
          background: #020617 !important;
          font-family: 'Inter', sans-serif !important;
        }
        .leaflet-tile-pane {
          opacity: 0.85;
        }
      `}</style>
    </div>
  );
}
