"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import * as d3 from "d3";
import { getRiskColor } from "@/lib/utils";
import {
  type GraphNode, type GraphEdge, type Transaction, type RealtimeSubgraph,
} from "@/lib/types";
import { fetchGraphNetwork, fetchSubgraph } from "@/lib/api";
import { NodeDrawer } from "./NodeDrawer";

// ── Time helpers ─────────────────────────────────────────────
function sliderToTimestamp(val: number): number {
  const now = Date.now();
  const windowMs = 48 * 60 * 60 * 1000;
  return now - windowMs + (val / 100) * windowMs;
}

function formatSliderTime(val: number): string {
  const ts = sliderToTimestamp(val);
  const now = Date.now();
  const diffH = Math.round((now - ts) / (60 * 60 * 1000));
  if (diffH <= 0) return "Now";
  if (diffH < 1) return `${Math.round((now - ts) / 60000)}m ago`;
  return `${diffH}h ago`;
}

// ── D3 type augmentation ─────────────────────────────────────
type SimNode = GraphNode & d3.SimulationNodeDatum & { _level?: number; _birth?: number };
interface SimEdge {
  source: SimNode | string;
  target: SimNode | string;
  amount: number;
  count: number;
  timestamp: Date;
  is3Hop: boolean;
  _level?: number;
  _velocity?: number;
  _birth?: number;
}

// Max nodes before pruning oldest
const MAX_GRAPH_NODES = 200;
const RIPPLE_DURATION_MS = 1200;

interface GraphExplorerProps {
  onInspectNode?: (node: GraphNode) => void;
  transactions?: Transaction[];
}

export function GraphExplorer({ onInspectNode, transactions }: GraphExplorerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null);
  const nodesDataRef = useRef<SimNode[]>([]);
  const edgesDataRef = useRef<SimEdge[]>([]);
  const timeSliderRef = useRef(100);
  const layersRef = useRef<{
    edgeLyr: d3.Selection<SVGGElement, unknown, null, undefined>;
    particleLyr: d3.Selection<SVGGElement, unknown, null, undefined>;
    nodeLyr: d3.Selection<SVGGElement, unknown, null, undefined>;
    labelLyr: d3.Selection<SVGGElement, unknown, null, undefined>;
    rippleLyr: d3.Selection<SVGGElement, unknown, null, undefined>;
  } | null>(null);
  const processedTxRef = useRef<Set<string>>(new Set());
  const dimensionsRef = useRef({ width: 0, height: 0 });
  const lastSubgraphRef = useRef<RealtimeSubgraph | null>(null);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [timeSlider, setTimeSlider] = useState(100);
  const [visibleEdgeCount, setVisibleEdgeCount] = useState(0);
  const [blastRadiusNodeId, setBlastRadiusNodeId] = useState<string | null>(null);
  const [blastRadiusSet, setBlastRadiusSet] = useState<Set<string>>(new Set());
  const [totalEdges, setTotalEdges] = useState(0);
  const [totalNodes, setTotalNodes] = useState(0);
  const [realtimeStats, setRealtimeStats] = useState({ injected: 0, cycles: 0 });

  useEffect(() => { timeSliderRef.current = timeSlider; }, [timeSlider]);

  // ── Blast radius BFS ───────────────────────────────────────
  const calculateBlastRadius = useCallback((nodeId: string) => {
    if (blastRadiusNodeId === nodeId) {
      setBlastRadiusNodeId(null);
      setBlastRadiusSet(new Set());
      return;
    }
    const edges = edgesDataRef.current;
    const visited = new Set<string>();
    visited.add(nodeId);
    let frontier = [nodeId];
    for (let hop = 0; hop < 3; hop++) {
      const next: string[] = [];
      for (const nid of frontier) {
        for (const e of edges) {
          const sid = typeof e.source === "string" ? e.source : e.source.id;
          const tid = typeof e.target === "string" ? e.target : e.target.id;
          if (sid === nid && !visited.has(tid)) { visited.add(tid); next.push(tid); }
          if (tid === nid && !visited.has(sid)) { visited.add(sid); next.push(sid); }
        }
      }
      frontier = next;
    }
    setBlastRadiusNodeId(nodeId);
    setBlastRadiusSet(visited);
  }, [blastRadiusNodeId]);

  // ── Helper: rebuild node visuals ───────────────────────────
  const rebuildNodeVisuals = useCallback(() => {
    const layers = layersRef.current;
    const sim = simRef.current;
    if (!layers || !sim) return;

    const simNodes = nodesDataRef.current;
    const simEdges = edgesDataRef.current;

    // Update simulation data
    sim.nodes(simNodes);
    const linkForce = sim.force("link") as d3.ForceLink<SimNode, SimEdge>;
    if (linkForce) linkForce.links(simEdges);

    // Rebuild node groups
    const nodeGrps = layers.nodeLyr.selectAll<SVGGElement, SimNode>("g")
      .data(simNodes, (d) => d.id)
      .join(
        (enter) => {
          const g = enter.append("g").attr("cursor", "pointer");

          // Aggregator halo
          g.filter((d) => d.type === "aggregator")
            .append("circle").attr("r", 22)
            .attr("fill", "none").attr("stroke", "rgba(239,68,68,0.3)")
            .attr("stroke-width", 1.5).attr("filter", "url(#cGlow)");

          // Critical outer bleed
          g.filter((d) => d.riskScore >= 80)
            .append("circle").attr("class", "cg")
            .attr("r", (d) => d.type === "aggregator" ? 20 : d.type === "mule" ? 16 : 12)
            .attr("fill", "rgba(239,68,68,0.08)").attr("filter", "url(#cGlow)");

          // Blocked ring
          g.filter((d) => d.isBlocked)
            .append("circle")
            .attr("r", (d) => d.type === "aggregator" ? 20 : 14)
            .attr("fill", "none").attr("stroke", "rgba(239,68,68,0.5)")
            .attr("stroke-width", 2).attr("stroke-dasharray", "3 3");

          // Main body
          g.append("circle").attr("class", "nb")
            .attr("r", (d) => d.type === "aggregator" ? 14 : d.type === "mule" ? 10 : 6)
            .attr("fill", (d) => getRiskColor(d.riskScore) + (d.type === "user" ? "90" : "ff"))
            .attr("stroke", (d) => getRiskColor(d.riskScore))
            .attr("stroke-width", 1);

          g.filter((d) => d.isFlagged).select(".nb").attr("filter", "url(#nGlow)");

          // Entrance animation — "pop" ripple
          g.each(function (d) {
            if (d._birth && Date.now() - d._birth < RIPPLE_DURATION_MS) {
              d3.select(this).select(".nb")
                .attr("r", 0)
                .transition().duration(400).ease(d3.easeBackOut.overshoot(3))
                .attr("r", d.type === "aggregator" ? 14 : d.type === "mule" ? 10 : 6);
            }
          });

          // Events
          g.on("click", (_ev, d) => setSelectedNode(d));
          g.on("mouseenter", function () {
            d3.select(this).select(".nb").transition().duration(150)
              .attr("stroke-width", 3).attr("filter", "url(#nGlow)");
          });
          g.on("mouseleave", function (_ev, d) {
            d3.select(this).select(".nb").transition().duration(150)
              .attr("stroke-width", d.isFlagged ? 1.5 : 1)
              .attr("filter", d.isFlagged ? "url(#nGlow)" : null);
          });

          // Drag
          g.call(d3.drag<SVGGElement, SimNode>()
            .on("start", (ev, d) => { if (!ev.active) sim.alphaTarget(0.1).restart(); d.fx = d.x; d.fy = d.y; })
            .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
            .on("end", (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
          );

          return g;
        },
        (update) => update,
        (exit) => exit.transition().duration(300).attr("opacity", 0).remove()
      );

    // Labels (mules + aggregators)
    layers.labelLyr.selectAll<SVGTextElement, SimNode>("text")
      .data(simNodes.filter((d) => d.type !== "user"), (d) => d.id)
      .join("text")
      .attr("text-anchor", "middle").attr("fill", "#f1f5f9")
      .attr("font-size", 10).attr("font-family", "'Inter', sans-serif")
      .attr("pointer-events", "none")
      .text((d) => d.name.split(" ")[0]);

    setTotalNodes(simNodes.length);
    setTotalEdges(simEdges.length);
    sim.alpha(0.15).restart();
  }, []);

  // ── D3 setup (initial) ────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;

    const { width, height } = container.getBoundingClientRect();
    dimensionsRef.current = { width, height };

    // Fetch graph data from backend with retry logic
    const fetchWithRetry = async (retries = 5, delayMs = 3000): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> => {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const data = await fetchGraphNetwork(0);
          if (data.nodes.length > 0) return data;
        } catch (err) {
          console.warn(`[GraphExplorer] Fetch attempt ${attempt + 1}/${retries} failed:`, err);
        }
        if (attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      return { nodes: [], edges: [] };
    };

    const initGraph = async () => {
      const { nodes: rawNodes, edges: rawEdges } = await fetchWithRetry();

    const now = Date.now();
    const windowMs = 48 * 60 * 60 * 1000;

    const simNodes: SimNode[] = rawNodes.map((n, i) => ({
      ...n,
      x: width / 2 + Math.cos(i * 0.5) * (150 + Math.random() * 200),
      y: height / 2 + Math.sin(i * 0.5) * (150 + Math.random() * 200),
    }));

    const simEdges: SimEdge[] = rawEdges
      .map((e) => ({
        source: e.source,
        target: e.target,
        amount: e.amount,
        count: e.count,
        timestamp: new Date(now - windowMs + Math.random() * windowMs),
        is3Hop: e.is3Hop,
      }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    nodesDataRef.current = simNodes;
    edgesDataRef.current = simEdges;
    setTotalEdges(simEdges.length);
    setTotalNodes(simNodes.length);

    const sel = d3.select(svg);
    sel.selectAll("*").remove();

    // ── SVG Defs (filters + marching ants pattern) ───────────
    const defs = sel.append("defs");

    const mkGlow = (id: string, std: number) => {
      const f = defs.append("filter").attr("id", id)
        .attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
      f.append("feGaussianBlur").attr("stdDeviation", std).attr("result", "b");
      const m = f.append("feMerge");
      m.append("feMergeNode").attr("in", "b");
      m.append("feMergeNode").attr("in", "SourceGraphic");
    };
    mkGlow("nGlow", 4);
    mkGlow("eGlow", 3);
    mkGlow("cGlow", 8);

    // Ripple filter
    const rFilter = defs.append("filter").attr("id", "ripple")
      .attr("x", "-100%").attr("y", "-100%").attr("width", "300%").attr("height", "300%");
    rFilter.append("feGaussianBlur").attr("stdDeviation", 2).attr("result", "b");
    const rm = rFilter.append("feMerge");
    rm.append("feMergeNode").attr("in", "b");
    rm.append("feMergeNode").attr("in", "SourceGraphic");

    // ── Layers ───────────────────────────────────────────────
    const g = sel.append("g").attr("class", "zg");
    sel.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on("zoom", (e) => g.attr("transform", e.transform))
    );

    const edgeLyr = g.append("g");
    const particleLyr = g.append("g");
    const rippleLyr = g.append("g");
    const nodeLyr = g.append("g");
    const labelLyr = g.append("g");

    layersRef.current = { edgeLyr, particleLyr, nodeLyr, labelLyr, rippleLyr };

    // ── Force Simulation ─────────────────────────────────────
    const sim = d3.forceSimulation<SimNode>(simNodes)
      .force("link", d3.forceLink<SimNode, SimEdge>(simEdges).id((d) => d.id).distance(120).strength(0.3))
      .force("charge", d3.forceManyBody<SimNode>().strength(-300).distanceMax(350))
      .force("center", d3.forceCenter(width / 2, height / 2).strength(0.05))
      .force("collide", d3.forceCollide<SimNode>().radius((d) =>
        d.type === "aggregator" ? 22 : d.type === "mule" ? 16 : 10
      ))
      .alphaDecay(0.01)
      .velocityDecay(0.3);
    simRef.current = sim;

    // Initial node visuals
    rebuildNodeVisuals();

    // ── Tick ──────────────────────────────────────────────────
    sim.on("tick", () => {
      const cutoff = sliderToTimestamp(timeSliderRef.current);
      const nowMs = Date.now();
      const tenMin = 10 * 60 * 1000;
      const currentEdges = edgesDataRef.current;
      const vis = currentEdges.filter((e) => e.timestamp.getTime() <= cutoff);
      setVisibleEdgeCount(vis.length);

      // Edges
      edgeLyr.selectAll<SVGLineElement, SimEdge>("line")
        .data(vis, (d) => `${(d.source as SimNode).id}-${(d.target as SimNode).id}-${d.amount}`)
        .join("line")
        .attr("x1", (d) => (d.source as SimNode).x!)
        .attr("y1", (d) => (d.source as SimNode).y!)
        .attr("x2", (d) => (d.target as SimNode).x!)
        .attr("y2", (d) => (d.target as SimNode).y!)
        .attr("stroke", (d) => {
          const s = d.source as SimNode, t = d.target as SimNode;
          const hot = (nowMs - d.timestamp.getTime()) < tenMin;
          const isNewEdge = d._birth && (nowMs - d._birth) < 5000;
          if (isNewEdge) return d._level === 3 ? "rgba(239,68,68,0.7)" : "rgba(56,189,248,0.7)";
          if (d.is3Hop) return hot ? "rgba(167,139,250,0.6)" : "rgba(167,139,250,0.2)";
          const susp = s.type !== "user" || t.type !== "user";
          return susp
            ? (hot ? "rgba(239,68,68,0.55)" : "rgba(239,68,68,0.25)")
            : (hot ? "rgba(56,189,248,0.35)" : "rgba(56,189,248,0.12)");
        })
        .attr("stroke-width", (d) => {
          const hot = (nowMs - d.timestamp.getTime()) < tenMin;
          const isNewEdge = d._birth && (nowMs - d._birth) < 5000;
          if (isNewEdge) return 3;
          return hot ? Math.min(4, d.count * 0.5 + 1.5) : Math.min(3, d.count * 0.3 + 0.5);
        })
        .attr("stroke-dasharray", (d) => {
          // Marching ants for new subgraph edges
          if (d._birth && (nowMs - d._birth) < 8000) {
            const speed = d._velocity || 100;
            const dashLen = Math.max(3, Math.min(12, speed / 50));
            return `${dashLen} ${dashLen * 1.5}`;
          }
          return d.is3Hop ? "4 6" : null;
        })
        .attr("filter", (d) => {
          if (d._birth && (nowMs - d._birth) < 5000) return "url(#eGlow)";
          return (nowMs - d.timestamp.getTime()) < tenMin ? "url(#eGlow)" : null;
        });

      // Hot particles + marching ants particles
      const hotEdges = vis.filter((e) => {
        const hot = (nowMs - e.timestamp.getTime()) < tenMin;
        const isNew = e._birth && (nowMs - e._birth) < 8000;
        return hot || isNew;
      });
      particleLyr.selectAll<SVGCircleElement, SimEdge>("circle")
        .data(hotEdges, (d) => `p-${(d.source as SimNode).id}-${(d.target as SimNode).id}-${d.amount}`)
        .join("circle")
        .attr("r", (d) => d._birth && (nowMs - d._birth) < 5000 ? 3 : 2.5)
        .attr("filter", "url(#eGlow)")
        .attr("fill", (d) => {
          const s = d.source as SimNode, t = d.target as SimNode;
          if (d._birth && (nowMs - d._birth) < 5000) return "#22d3ee";
          return (s.type !== "user" || t.type !== "user") ? "#ef4444" : "#38bdf8";
        })
        .each(function (d) {
          const s = d.source as SimNode, t = d.target as SimNode;
          if (!s.x || !s.y || !t.x || !t.y) return;
          const dx = t.x - s.x, dy = t.y - s.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          // Speed-based particle movement
          const speed = d._velocity ? Math.max(0.0002, Math.min(0.002, d._velocity / 100000)) : 0.0003;
          const p = ((nowMs * speed + d.count * 137) % len) / len;
          d3.select(this).attr("cx", s.x + dx * p).attr("cy", s.y + dy * p);
        });

      // Nodes
      const currentNodes = nodesDataRef.current;
      nodeLyr.selectAll<SVGGElement, SimNode>("g")
        .attr("transform", (d) => `translate(${d.x},${d.y})`);

      // Labels
      labelLyr.selectAll<SVGTextElement, SimNode>("text")
        .attr("x", (d) => d.x!)
        .attr("y", (d) => d.y! - (d.type === "aggregator" ? 20 : 16));

      // Ripple cleanup
      rippleLyr.selectAll<SVGCircleElement, unknown>("circle")
        .each(function () {
          const el = d3.select(this);
          const birth = Number(el.attr("data-birth"));
          if (nowMs - birth > RIPPLE_DURATION_MS) el.remove();
        });
    });

    return () => { sim.stop(); };
    }; // end initGraph()
    initGraph();
    return () => { simRef.current?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildNodeVisuals]);

  // ── Real-time subgraph injection ───────────────────────────
  useEffect(() => {
    if (!transactions || transactions.length === 0) return;
    const sim = simRef.current;
    const layers = layersRef.current;
    if (!sim || !layers) return;

    // Process only the latest transaction not yet processed
    const latest = transactions[0]; // newest first
    if (!latest || processedTxRef.current.has(latest.id)) return;
    processedTxRef.current.add(latest.id);

    // Only inject subgraph for every 3rd transaction to avoid overwhelming
    if (processedTxRef.current.size % 3 !== 0) return;

    // Fetch subgraph from backend — use senderName (user_id) not tx id
    const injectSubgraph = async () => {
      let subgraph: RealtimeSubgraph;
      try {
        const userId = latest.senderName || latest.id;
        subgraph = await fetchSubgraph(userId);
      } catch {
        // If subgraph fetch fails (e.g. node not yet in Neo4j), skip injection
        return;
      }
      lastSubgraphRef.current = subgraph;
    const nowMs = Date.now();
    const { width, height } = dimensionsRef.current;
    const existingNodes = nodesDataRef.current;
    const existingEdges = edgesDataRef.current;
    const existingIds = new Set(existingNodes.map(n => n.id));

    // Map subgraph nodes → SimNodes
    const newNodes: SimNode[] = [];
    for (const sn of subgraph.nodes) {
      if (existingIds.has(sn.id)) continue;
      const simNode: SimNode = {
        id: sn.id,
        name: sn.name,
        upi: sn.upi,
        type: sn.type,
        riskScore: sn.riskScore,
        fanIn: sn.fanIn,
        fanOut: sn.fanOut,
        betweennessCentrality: subgraph.betweennessCentrality,
        pageRank: 0.01,
        deviceCount: sn.deviceCount,
        city: sn.city,
        lastActive: new Date(),
        isFlagged: sn.riskScore >= 60,
        isBlocked: false,
        cycleDetected: subgraph.cycleNodes.includes(sn.id),
        localClusterCoeff: 0.1,
        _level: sn.level,
        _birth: nowMs,
        x: width / 2 + (Math.random() - 0.5) * 200,
        y: height / 2 + (Math.random() - 0.5) * 200,
      };
      newNodes.push(simNode);
    }

    // Map subgraph edges → SimEdges
    const newEdges: SimEdge[] = [];
    for (const se of subgraph.edges) {
      const sExists = existingIds.has(se.source) || newNodes.find(n => n.id === se.source);
      const tExists = existingIds.has(se.target) || newNodes.find(n => n.id === se.target);
      if (!sExists || !tExists) continue;
      newEdges.push({
        source: se.source,
        target: se.target,
        amount: se.amount,
        count: 1,
        timestamp: se.timestamp,
        is3Hop: se.level === 3,
        _level: se.level,
        _velocity: se.velocity,
        _birth: nowMs,
      });
    }

    if (newNodes.length === 0 && newEdges.length === 0) return;

    // Prune oldest nodes if exceeding max
    const combinedNodes = [...existingNodes, ...newNodes];
    if (combinedNodes.length > MAX_GRAPH_NODES) {
      const excess = combinedNodes.length - MAX_GRAPH_NODES;
      // Remove oldest user-type nodes first
      const sortable = combinedNodes
        .map((n, i) => ({ node: n, idx: i }))
        .filter(({ node }) => node.type === "user" && !node.isFlagged)
        .sort((a, b) => {
          const aB = a.node._birth || 0;
          const bB = b.node._birth || 0;
          return aB - bB;
        });
      const toRemoveIds = new Set(sortable.slice(0, excess).map(s => s.node.id));
      nodesDataRef.current = combinedNodes.filter(n => !toRemoveIds.has(n.id));
      edgesDataRef.current = [...existingEdges, ...newEdges].filter(e => {
        const sid = typeof e.source === "string" ? e.source : e.source.id;
        const tid = typeof e.target === "string" ? e.target : e.target.id;
        return !toRemoveIds.has(sid) && !toRemoveIds.has(tid);
      });
    } else {
      nodesDataRef.current = combinedNodes;
      edgesDataRef.current = [...existingEdges, ...newEdges];
    }

    // Spawn ripple circles for new nodes
    for (const nn of newNodes) {
      layers.rippleLyr.append("circle")
        .attr("cx", nn.x!).attr("cy", nn.y!)
        .attr("r", 5)
        .attr("fill", "none")
        .attr("stroke", getRiskColor(nn.riskScore))
        .attr("stroke-width", 2)
        .attr("opacity", 0.8)
        .attr("data-birth", String(nowMs))
        .attr("filter", "url(#ripple)")
        .transition().duration(RIPPLE_DURATION_MS).ease(d3.easeQuadOut)
        .attr("r", 40)
        .attr("opacity", 0)
        .remove();
    }

    // Update stats
    setRealtimeStats(prev => ({
      injected: prev.injected + newNodes.length,
      cycles: prev.cycles + (subgraph.cycleDetected ? 1 : 0),
    }));

    rebuildNodeVisuals();
    }; // end injectSubgraph()
    injectSubgraph();
  }, [transactions, rebuildNodeVisuals]);

  // Slider restart
  useEffect(() => {
    simRef.current?.alpha(0.05).restart();
  }, [timeSlider]);

  // Blast radius dimming
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const s = d3.select(svg);
    const active = blastRadiusNodeId !== null;
    s.selectAll<SVGGElement, SimNode>(".zg g:nth-child(4) g")
      .attr("opacity", (d) => (!active || blastRadiusSet.has(d.id)) ? 1 : 0.12);
    s.selectAll<SVGTextElement, SimNode>(".zg g:nth-child(5) text")
      .attr("opacity", (d) => (!active || blastRadiusSet.has(d.id)) ? 1 : 0.08);
  }, [blastRadiusNodeId, blastRadiusSet]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e293b]">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[#f1f5f9]">Neural Graph Explorer</h2>
          <div className="flex items-center gap-2 text-xs text-[#64748b]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#10b981]" /> Users</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#f59e0b]" /> Mules</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#ef4444]" /> Aggregators</span>
            <span className="flex items-center gap-1 ml-2">
              <span className="w-4 border-t border-dashed border-[#a78bfa]" /> 3-Hop
            </span>
            <span className="flex items-center gap-1 ml-2">
              <span className="w-3 h-0.5 bg-[#22d3ee] rounded-full shadow-[0_0_6px_rgba(34,211,238,0.5)]" /> Live
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-[#64748b]">
          <span>{totalNodes} nodes</span>
          <span>•</span>
          <span>{totalEdges} edges</span>
          {realtimeStats.injected > 0 && (
            <>
              <span className="text-[10px] text-cyan-400/80 font-mono">+{realtimeStats.injected} live</span>
              {realtimeStats.cycles > 0 && (
                <span className="text-[10px] text-red-400/80 font-mono">{realtimeStats.cycles} cycles</span>
              )}
            </>
          )}
          <span className="text-[10px] ml-1 text-sky-400/60 font-mono">D3.js Realtime</span>
        </div>
      </div>

      {/* SVG */}
      <div ref={containerRef} className="flex-1 relative min-h-0 bg-[#020617]">
        <svg ref={svgRef} className="absolute inset-0 w-full h-full cursor-crosshair" />
        {/* Marching ants CSS */}
        <style>{`
          @keyframes marchingAnts {
            to { stroke-dashoffset: -24; }
          }
        `}</style>
      </div>

      {/* Time-Travel Slider */}
      <div className="px-4 py-3 border-t border-[#1e293b] bg-[#0f172a]">
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#64748b] font-mono w-12">T-48h</span>
          <div className="flex-1 flex flex-col gap-1">
            <input
              type="range"
              min={0}
              max={100}
              value={timeSlider}
              onChange={(e) => setTimeSlider(Number(e.target.value))}
              className="w-full h-1 appearance-none bg-[#1e293b] rounded-full cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#38bdf8]
                [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(56,189,248,0.5)]"
            />
            <div className="flex justify-between px-0.5">
              {[0, 25, 50, 75, 100].map((tick) => (
                <span key={tick} className="text-[8px] text-[#334155] font-mono">
                  {tick === 100 ? "Now" : `${Math.round(48 - (tick / 100) * 48)}h`}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col items-end w-24">
            <span className="text-xs text-[#f1f5f9] font-mono font-semibold">
              {formatSliderTime(timeSlider)}
            </span>
            <span className="text-[9px] text-[#64748b] font-mono">
              {visibleEdgeCount}/{totalEdges} edges
            </span>
          </div>
        </div>
      </div>

      {/* Node Drawer */}
      {selectedNode && (
        <NodeDrawer
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onBlastRadius={calculateBlastRadius}
          isBlastActive={blastRadiusNodeId === selectedNode.id}
          onInspect={onInspectNode}
        />
      )}
    </div>
  );
}
