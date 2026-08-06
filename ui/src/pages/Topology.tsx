import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation, type SimulationNodeDatum } from "d3-force";
import { Minus, Plus, Maximize, Minimize, RotateCcw, Activity } from "lucide-react";
import { Layout } from "../components/Layout";
import { StatusDot, statusColor } from "../components/StatusDot";
import { api } from "../api/client";
import { useWsMessages } from "../ws/WebSocketProvider";
import { useContainerSize } from "../hooks/useContainerSize";
import type { DeviceGroup, DeviceType } from "../api/types";
import { DEVICE_TYPE_LABELS } from "../api/types";
import { Button } from "../components/ui";
import { BentoCard } from "../components/charts/BentoCard";
import { DEVICE_STATE_HEX } from "../lib/statusTokens";
import type { DeviceState } from "../lib/statusTokens";
import { formatBps } from "../lib/format";

interface DeviceRow {
  id: string;
  name: string;
  ip: string;
  type: DeviceType;
  groupId: string | null;
  state: string | null;
  snmpCredsEnc?: string | null;
  criticalAsset?: boolean;
}

const LEGEND_STATES: DeviceState[] = ["up", "degraded", "down", "flapping", "maintenance"];

interface BandwidthCheckShape {
  id: string;
  deviceId: string;
  kind: string;
  enabled: boolean;
  config: { interfaces?: number[] };
}

interface Node extends SimulationNodeDatum {
  id: string;
  kind: "device" | "center";
  label: string;
  device?: DeviceRow;
  groupId?: string; // set on group center nodes ("group:<id>"), absent on the core node
}

interface Link {
  source: string;
  target: string;
}

interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

type Selection = { kind: "device"; device: DeviceRow } | { kind: "group"; groupId: string | null; name: string } | null;

const CORE_ID = "__core__";
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;

export function Topology() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [, forceRerender] = useState(0);
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, k: 1 });
  const [fullscreen, setFullscreen] = useState(false);
  const [showBandwidth, setShowBandwidth] = useState(false);
  const [bandwidthByDevice, setBandwidthByDevice] = useState<Record<string, number>>({});
  const [reducedMotion, setReducedMotion] = useState(false);
  const navigate = useNavigate();
  const { ref: containerRef, size } = useContainerSize<HTMLDivElement>();

  const nodesRef = useRef<Node[]>([]);
  const linksRef = useRef<Link[]>([]);
  const simRef = useRef<Simulation<Node, undefined> | null>(null);
  const draggingRef = useRef<string | null>(null);
  const movedRef = useRef(false);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  // A stable callback ref, not a new inline function every render: an inline `ref={(el) => ...}`
  // is a different function identity each render, so React detaches and reattaches it every time —
  // which re-triggers useContainerSize's own setSize on every single render and, combined with the
  // d3-force "tick" handler's own frequent re-renders, spirals into "Maximum update depth exceeded."
  const setWrapperEl = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef(el);
      wrapperRef.current = el;
    },
    [containerRef]
  );

  async function loadData() {
    const [devicePage, groupList, positions] = await Promise.all([
      api.get<{ items: DeviceRow[] }>("/devices?withStatus=true&limit=2000"),
      api.get<DeviceGroup[]>("/groups"),
      api.get<Array<{ nodeId: string; x: number; y: number }>>("/topology/positions"),
    ]);
    setDevices(devicePage.items);
    setGroups(groupList);

    const posMap = new Map(positions.map((p) => [p.nodeId, p]));
    const width = size.width || 800;
    const height = size.height || 600;

    const corePos = posMap.get(CORE_ID);
    const centerNodes: Node[] = [
      {
        id: CORE_ID,
        kind: "center",
        label: "Core",
        x: corePos?.x ?? width / 2,
        y: corePos?.y ?? height / 2,
        fx: corePos?.x ?? width / 2,
        fy: corePos?.y ?? height / 2,
      },
    ];
    for (const g of groupList) {
      const saved = posMap.get(`group:${g.id}`);
      centerNodes.push({
        id: `group:${g.id}`,
        kind: "center",
        label: g.name,
        groupId: g.id,
        x: saved?.x ?? width / 2 + (Math.random() - 0.5) * 160,
        y: saved?.y ?? height / 2 + (Math.random() - 0.5) * 160,
        fx: saved?.x,
        fy: saved?.y,
      });
    }

    const deviceNodes: Node[] = devicePage.items.map((d) => {
      const saved = posMap.get(d.id);
      return {
        id: d.id,
        kind: "device",
        label: d.name,
        device: d,
        x: saved?.x ?? width / 2 + (Math.random() - 0.5) * 100,
        y: saved?.y ?? height / 2 + (Math.random() - 0.5) * 100,
        fx: saved?.x,
        fy: saved?.y,
      };
    });

    const links: Link[] = devicePage.items.map((d) => ({
      source: d.id,
      target: d.groupId ? `group:${d.groupId}` : CORE_ID,
    }));
    for (const g of groupList) {
      links.push({ source: `group:${g.id}`, target: CORE_ID });
    }

    nodesRef.current = [...centerNodes, ...deviceNodes];
    linksRef.current = links;

    simRef.current?.stop();
    const sim = forceSimulation(nodesRef.current)
      .force(
        "link",
        forceLink<Node, Link>(linksRef.current)
          .id((d) => d.id)
          .distance((l) => ((l.source as unknown as Node).kind === "center" && (l.target as unknown as Node).kind === "center" ? 130 : 70))
      )
      .force("charge", forceManyBody().strength(-140))
      .force("collide", forceCollide((d) => (d.kind === "center" ? 40 : 26)))
      .force("center", forceCenter(width / 2, height / 2))
      .on("tick", () => forceRerender((n) => n + 1));
    simRef.current = sim;
  }

  const hasCenteredRef = useRef(false);
  useEffect(() => {
    loadData()
      .then(() => {
        // Once, not on every reload — this effect also re-fires on container resize, and refiring
        // the auto-center there would yank the view back to the core under someone's cursor mid-pan.
        // The point is "open the page already looking at the network," not "always snap back."
        //
        // Gated on a real measured size, not just "has this run before": useContainerSize's
        // ResizeObserver hasn't reported anything on the very first render, so this effect's first
        // firing sees size.width/height still at 0 — computing a transform against a 0×0 viewport
        // and never revisiting it (the ref was already flipped) is exactly what left the map
        // rendered off-screen after every refresh until "Reset" recomputed it against the real size.
        if (!hasCenteredRef.current && size.width > 0 && size.height > 0) {
          hasCenteredRef.current = true;
          centerOnCore();
        }
      })
      .catch(() => {});
    return () => {
      simRef.current?.stop();
    };
  }, [size.width, size.height]);

  useEffect(() => {
    function onFsChange() {
      setFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // The bandwidth overlay's flow particles are real motion (SVG SMIL <animateMotion>, not a CSS
  // animation/transition), so the app-wide prefers-reduced-motion rule in index.css — which only
  // targets animation-duration/transition-duration — doesn't reach them. Checked explicitly here
  // instead so this is the one place that has to remember it.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Bandwidth overlay is opt-in and only fetched once toggled on — reuses the same
  // checks-then-latest-metric pattern as the Dashboard's BandwidthSummaryCard, capped at 30
  // SNMP-capable devices so toggling this on a large fleet doesn't fire hundreds of requests.
  useEffect(() => {
    if (!showBandwidth) return;
    let cancelled = false;
    async function load() {
      const snmpDevices = devices.filter((d) => d.snmpCredsEnc).slice(0, 30);
      const entries = await Promise.all(
        snmpDevices.map(async (d) => {
          const checks = await api.get<BandwidthCheckShape[]>(`/devices/${d.id}/checks`).catch(() => []);
          const check = checks.find((c) => c.kind === "snmp" && c.enabled && (c.config.interfaces?.length ?? 0) > 0);
          if (!check) return [d.id, 0] as const;
          const totals = await Promise.all(
            (check.config.interfaces ?? []).map(async (ifIndex) => {
              const [inRes, outRes] = await Promise.all([
                api.get<{ points: Array<{ value: number }> }>(`/metrics/${d.id}?range=1h&name=if${ifIndex}.inBps`).catch(() => ({ points: [] })),
                api.get<{ points: Array<{ value: number }> }>(`/metrics/${d.id}?range=1h&name=if${ifIndex}.outBps`).catch(() => ({ points: [] })),
              ]);
              const last = (points: Array<{ value: number }>) => points[points.length - 1]?.value ?? 0;
              return last(inRes.points) + last(outRes.points);
            })
          );
          return [d.id, totals.reduce((sum, v) => sum + v, 0)] as const;
        })
      );
      if (!cancelled) setBandwidthByDevice(Object.fromEntries(entries));
    }
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showBandwidth, devices]);

  useWsMessages((msg) => {
    const evt = msg as { type?: string; deviceId?: string; state?: string };
    if (evt.type === "device.status_changed" && evt.deviceId) {
      const node = nodesRef.current.find((n) => n.id === evt.deviceId);
      if (node?.device) node.device.state = evt.state ?? node.device.state;
      forceRerender((n) => n + 1);
    }
  });

  /** Screen (mouse) coordinates -> simulation-space coordinates, accounting for the current pan/zoom transform. */
  function toWorld(clientX: number, clientY: number) {
    const rect = svgRef.current!.getBoundingClientRect();
    const { x, y, k } = viewRef.current;
    return { x: (clientX - rect.left - x) / k, y: (clientY - rect.top - y) / k };
  }

  function startDrag(nodeId: string) {
    draggingRef.current = nodeId;
    movedRef.current = false;
    simRef.current?.alphaTarget(0.2).restart();
  }

  function startPan(e: React.MouseEvent<SVGSVGElement>) {
    panRef.current = { startX: e.clientX, startY: e.clientY, originX: view.x, originY: view.y };
  }

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (draggingRef.current) {
      movedRef.current = true;
      const { x, y } = toWorld(e.clientX, e.clientY);
      const node = nodesRef.current.find((n) => n.id === draggingRef.current);
      if (node) {
        node.fx = x;
        node.fy = y;
        forceRerender((n) => n + 1);
      }
      return;
    }
    if (panRef.current) {
      const { startX, startY, originX, originY } = panRef.current;
      setView((v) => ({ ...v, x: originX + (e.clientX - startX), y: originY + (e.clientY - startY) }));
    }
  }

  async function endDrag() {
    const id = draggingRef.current;
    const moved = movedRef.current;
    draggingRef.current = null;
    movedRef.current = false;
    panRef.current = null;
    simRef.current?.alphaTarget(0);
    if (!id || !moved) return;
    const node = nodesRef.current.find((n) => n.id === id);
    if (node && node.fx != null && node.fy != null) {
      await api.put("/topology/positions", { nodeId: id, x: node.fx, y: node.fy });
    }
  }

  function selectNode(n: Node) {
    if (n.kind === "device" && n.device) {
      setSelection({ kind: "device", device: n.device });
    } else if (n.kind === "center") {
      setSelection({ kind: "group", groupId: n.groupId ?? null, name: n.label });
    }
  }

  function zoomAt(cx: number, cy: number, nextK: number) {
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextK));
      const x = cx - ((cx - v.x) / v.k) * k;
      const y = cy - ((cy - v.y) / v.k) * k;
      return { x, y, k };
    });
  }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, view.k * (1 - e.deltaY * 0.001));
  }

  function zoomButton(factor: number) {
    zoomAt(size.width / 2, size.height / 2, view.k * factor);
  }

  // Centers the viewport on wherever the core node actually sits in simulation space — {x:0,y:0,k:1}
  // (what this used to do) is only the identity transform, not "centered on anything." It happened
  // to look centered by coincidence on a freshly-seeded graph where the core starts at
  // width/2,height/2, but the moment the core is dragged, the window is resized, or the container
  // ref reports a different size than it did at first paint, "reset" would leave the core (and the
  // whole graph hanging off it) sitting off in a corner instead of front and center — the opposite
  // of what a reset button is for.
  function centerOnCore() {
    const core = nodesRef.current.find((n) => n.id === CORE_ID);
    const k = 1;
    const cx = core?.x ?? 0;
    const cy = core?.y ?? 0;
    setView({ x: size.width / 2 - cx * k, y: size.height / 2 - cy * k, k });
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await wrapperRef.current?.requestFullscreen();
    }
  }

  const nodes = nodesRef.current;
  const links = linksRef.current;
  const groupMembers = selection?.kind === "group" ? devices.filter((d) => d.groupId === selection.groupId) : [];
  const maxBandwidth = Math.max(1, ...Object.values(bandwidthByDevice));

  return (
    <Layout title="Map" subtitle="Live topology — drag to reposition, scroll to zoom">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div
          ref={setWrapperEl}
          className={`relative overflow-hidden border border-border bg-bg-canvas lg:col-span-3 ${fullscreen ? "" : "rounded-xl"}`}
          style={{ height: fullscreen ? "100vh" : "75vh" }}
        >
          {size.width > 0 && (
            <svg
              ref={svgRef}
              width={size.width}
              height={size.height}
              onMouseDown={startPan}
              onMouseMove={onMouseMove}
              onMouseUp={endDrag}
              onMouseLeave={endDrag}
              onWheel={onWheel}
              className="select-none"
              style={{ cursor: panRef.current ? "grabbing" : "grab" }}
              role="img"
              aria-label="Network topology map"
            >
              <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {links.map((l, i) => {
                  const source = nodes.find((n) => n.id === l.source || n.id === (l.source as unknown as Node).id);
                  const target = nodes.find((n) => n.id === l.target || n.id === (l.target as unknown as Node).id);
                  const s = typeof l.source === "object" ? (l.source as unknown as Node) : source;
                  const t = typeof l.target === "object" ? (l.target as unknown as Node) : target;
                  if (!s || !t || s.x == null || t.x == null) return null;
                  const dimmed = s.kind === "device" && s.device?.state === "down";
                  const bps = showBandwidth && s.kind === "device" ? (bandwidthByDevice[s.id] ?? 0) : 0;
                  const intensity = bps > 0 ? Math.min(1, bps / maxBandwidth) : 0;
                  // Direction matches how bandwidth is actually measured: from the device (source)
                  // toward the core, i.e. traffic leaving that device's link, not an arbitrary
                  // decoration — a link with no measured bandwidth gets no particle at all rather
                  // than motion implying data that isn't there.
                  const particleCount = intensity > 0.66 ? 3 : intensity > 0.33 ? 2 : 1;
                  const durationSec = 1.8 - intensity * 1.3; // faster line = more traffic
                  return (
                    <g key={i}>
                      <line
                        x1={s.x}
                        y1={s.y}
                        x2={t.x}
                        y2={t.y}
                        stroke={intensity > 0 ? "rgb(var(--color-accent))" : "rgb(var(--color-border-strong))"}
                        strokeOpacity={intensity > 0 ? 0.35 + intensity * 0.65 : dimmed ? 0.3 : 0.6}
                        strokeWidth={(intensity > 0 ? 1.5 + intensity * 3.5 : 1.5) / view.k}
                      >
                        {intensity > 0 && <title>{formatBps(bps)}</title>}
                      </line>
                      {intensity > 0 &&
                        !reducedMotion &&
                        Array.from({ length: particleCount }, (_, p) => (
                          <circle key={p} r={2.4 / view.k} fill="rgb(var(--color-accent))">
                            <animateMotion
                              path={`M${s.x},${s.y} L${t.x},${t.y}`}
                              dur={`${durationSec}s`}
                              begin={`${(p * durationSec) / particleCount}s`}
                              repeatCount="indefinite"
                            />
                          </circle>
                        ))}
                    </g>
                  );
                })}
                {nodes.map((n) => {
                  if (n.x == null || n.y == null) return null;
                  const isSelected =
                    n.kind === "device"
                      ? selection?.kind === "device" && selection.device.id === n.id
                      : selection?.kind === "group" && selection.groupId === (n.groupId ?? null);
                  if (n.kind === "center") {
                    return (
                      <g
                        key={n.id}
                        transform={`translate(${n.x},${n.y})`}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          startDrag(n.id);
                        }}
                        onClick={() => selectNode(n)}
                        style={{ cursor: "grab" }}
                      >
                        <circle
                          r={16}
                          fill="rgb(var(--color-bg-elevated))"
                          stroke={isSelected ? "rgb(var(--color-accent))" : "rgb(var(--color-border-strong))"}
                          strokeWidth={isSelected ? 3 : 2}
                        />
                        <circle r={16} fill="none" />
                        <text y={4} textAnchor="middle" fontSize={13} fill="rgb(var(--color-text-primary))" style={{ pointerEvents: "none" }}>
                          {n.id === CORE_ID ? "◈" : "▦"}
                        </text>
                        <text y={-24} textAnchor="middle" fontSize={11} fontWeight={600} fill="rgb(var(--color-text-secondary))">
                          {n.label}
                        </text>
                        <title>
                          {n.label} · {devices.filter((d) => (n.id === CORE_ID ? !d.groupId : d.groupId === n.groupId)).length} device(s)
                        </title>
                      </g>
                    );
                  }
                  const color = statusColor(n.device?.state ?? null);
                  const truncated = n.label.length > 12;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x},${n.y})`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        startDrag(n.id);
                      }}
                      onClick={() => selectNode(n)}
                      style={{ cursor: "grab" }}
                    >
                      {n.device?.state === "down" && <circle r={18} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5} />}
                      <circle r={14} fill="rgb(var(--color-bg-canvas))" stroke={isSelected ? "rgb(var(--color-accent))" : color} strokeWidth={isSelected ? 4 : 3} />
                      {/* Critical-asset marker — same signal as Inventory's lightning-bolt indicator
                          (pages instantly on DOWN, skips storm grouping), so the one property that
                          changes how an outage here actually gets handled is visible on the map
                          itself, not just buried in the device's own edit form. */}
                      {n.device?.criticalAsset && (
                        <circle cx={10} cy={-10} r={4} fill="rgb(var(--color-warning))" stroke="rgb(var(--color-bg-canvas))" strokeWidth={1.5} />
                      )}
                      <text y={26} textAnchor="middle" fontSize={10} fill="rgb(var(--color-text-primary))">
                        {truncated ? n.label.slice(0, 12) + "…" : n.label}
                      </text>
                      {/* Always present now, not just when the label truncates — name alone was the
                          only thing hovering a node ever told you; type/IP/status were a click away
                          even though they're exactly what a glance at a topology map is for. */}
                      <title>
                        {n.label} · {DEVICE_TYPE_LABELS[n.device!.type]} · {n.device!.ip} · {n.device?.state ?? "unknown"}
                        {n.device?.criticalAsset ? " · critical asset" : ""}
                      </title>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          {!fullscreen && (
            <div className="absolute left-3 top-3 rounded-md border border-border bg-bg-surface px-3 py-2 shadow-md">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {LEGEND_STATES.map((s) => (
                  <span key={s} className="flex items-center gap-1.5 text-2xs capitalize text-text-secondary">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: DEVICE_STATE_HEX[s] }} />
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-md border border-border bg-bg-surface shadow-md">
            <button
              onClick={() => setShowBandwidth((v) => !v)}
              aria-label="Toggle bandwidth overlay"
              aria-pressed={showBandwidth}
              title="Color/thicken edges by current device bandwidth"
              className={`cursor-pointer p-2 transition-colors duration-150 hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                showBandwidth ? "bg-accent-subtle text-accent" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              <Activity size={14} aria-hidden="true" />
            </button>
            <button
              onClick={() => zoomButton(1.3)}
              aria-label="Zoom in"
              className="cursor-pointer p-2 text-text-secondary transition-colors duration-150 hover:bg-bg-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Plus size={14} aria-hidden="true" />
            </button>
            <button
              onClick={() => zoomButton(1 / 1.3)}
              aria-label="Zoom out"
              className="cursor-pointer border-t border-border p-2 text-text-secondary transition-colors duration-150 hover:bg-bg-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Minus size={14} aria-hidden="true" />
            </button>
            <button
              onClick={centerOnCore}
              aria-label="Reset pan and zoom"
              title="Reset pan/zoom"
              className="cursor-pointer border-t border-border p-2 text-text-secondary transition-colors duration-150 hover:bg-bg-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <RotateCcw size={14} aria-hidden="true" />
            </button>
            <button
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              className="cursor-pointer border-t border-border p-2 text-text-secondary transition-colors duration-150 hover:bg-bg-subtle hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {fullscreen ? <Minimize size={14} aria-hidden="true" /> : <Maximize size={14} aria-hidden="true" />}
            </button>
          </div>
        </div>

        {!fullscreen && (
          <div className="space-y-4">
            <BentoCard className="p-4">
              <h3 className="mb-2 text-sm font-medium text-text-secondary">
                {devices.length} devices · {groups.length} groups
              </h3>
              {selection?.kind === "device" ? (
                <div className="space-y-2 text-sm">
                  <div className="text-lg font-semibold text-text-primary">{selection.device.name}</div>
                  <div className="font-mono text-text-secondary">{selection.device.ip}</div>
                  <div className="text-text-secondary">{DEVICE_TYPE_LABELS[selection.device.type]}</div>
                  <div className="capitalize text-text-secondary">Status: {selection.device.state ?? "unknown"}</div>
                  <Button className="mt-2 w-full" onClick={() => navigate(`/devices/${selection.device.id}`)}>
                    View device →
                  </Button>
                </div>
              ) : selection?.kind === "group" ? (
                <div className="space-y-2 text-sm">
                  <div className="text-lg font-semibold text-text-primary">{selection.name}</div>
                  <div className="text-xs text-text-secondary">
                    {groupMembers.length} device{groupMembers.length === 1 ? "" : "s"}
                  </div>
                  <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                    {groupMembers.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setSelection({ kind: "device", device: d })}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-bg-subtle"
                      >
                        <StatusDot state={d.state} />
                        <span className="truncate text-text-primary">{d.name}</span>
                        <span className="ml-auto shrink-0 font-mono text-text-secondary">{d.ip}</span>
                      </button>
                    ))}
                    {groupMembers.length === 0 && <p className="text-xs text-text-secondary">No devices in this group yet.</p>}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-text-secondary">
                  Click a node for details, drag any node (including groups) to reposition — saved automatically. Drag the background to pan, scroll to
                  zoom.
                </p>
              )}
            </BentoCard>

            <BentoCard className="p-4">
              <h3 className="mb-2 text-sm font-medium text-text-secondary">Groups</h3>
              <div className="space-y-1">
                <button
                  onClick={() => setSelection({ kind: "group", groupId: null, name: "Core" })}
                  className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-bg-subtle ${
                    selection?.kind === "group" && selection.groupId === null ? "bg-bg-subtle text-text-primary" : "text-text-secondary"
                  }`}
                >
                  <span>Core (ungrouped)</span>
                  <span className="text-xs tabular-nums">{devices.filter((d) => !d.groupId).length}</span>
                </button>
                {groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setSelection({ kind: "group", groupId: g.id, name: g.name })}
                    className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-bg-subtle ${
                      selection?.kind === "group" && selection.groupId === g.id ? "bg-bg-subtle text-text-primary" : "text-text-secondary"
                    }`}
                  >
                    <span className="truncate">{g.name}</span>
                    <span className="ml-2 shrink-0 text-xs tabular-nums">{devices.filter((d) => d.groupId === g.id).length}</span>
                  </button>
                ))}
              </div>
            </BentoCard>
          </div>
        )}
      </div>
    </Layout>
  );
}
