"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { DiagramLink, DiagramNode, DiagramSpec, Level, LensFact, Plane, Scale } from "./schema.ts";
import { resolveLenses } from "./presets.ts";
import { resolveLink } from "./resolve.ts";
import { TILE, computeLayout, findRoute, linkGeometry, roundedPath, zoneRects } from "./layout.ts";
import { routeLinks } from "./route.ts";
import type { Box } from "./layout.ts";
import { FLOOR_GAP, bandRectsOf, floorsBounds, layerHeight, projector, zoneLayers } from "./floors.ts";
import { genericPack, resolveIcon } from "./icons.tsx";
import type { IconPack } from "./icons.tsx";
import { DIAGRAM_CSS } from "./styles.ts";
import { THEMES, getTheme, themeStyle } from "./themes.ts";
import type { Theme } from "./themes.ts";
import { useReducedMotion } from "./useReducedMotion.ts";
import { collapseLevels, collapseZones, collapsedId, withoutPeripherals } from "./view.ts";
import { describeConnections } from "./describe.ts";
import { TextView } from "./TextView.tsx";
import { TraceBar } from "./TraceBar.tsx";
import type { TraceBarProps } from "./TraceBar.tsx";

/** How `spec.layers` are drawn. `floors`: strips in the flat view, and in the isometric view each layer lifted to its own height with arrows between floors. `off`: not drawn. */
export type LayerMode = "off" | "floors";

export type ArchDiagramProps = {
  spec: DiagramSpec;
  /** Defaults to the generic pack. Unknown keys fall back to it. */
  iconPack?: IconPack;
  /** Component the info strip describes when nothing is hovered. `null` shows the lens overview. */
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Component the request trace is currently at (null when not tracing). */
  traceNode?: string | null;
  /** Component the trace came from, so the pulse can travel along the cables between them. */
  prevTraceNode?: string | null;
  /** Node ids in trace order. When given, the whole route is shown at once with no animation: each step numbered on its card and the cables between steps lit. */
  path?: string[];
  /** The trace controls: a bar under the diagram that starts a trace, then narrates and steps it. Leave out for a diagram with no trace. */
  traceBar?: TraceBarProps | null;
  /** Defaults to the visitor's `prefers-reduced-motion` setting. */
  reducedMotion?: boolean;
  /** A built-in theme id (see `THEMES`) or a `Theme` object. Defaults to "brass". */
  theme?: string | Theme;
  /** When given, a theme picker appears in the toolbar and reports the choice here; the host keeps it (and may theme its own page). */
  onThemeChange?: (id: string) => void;
  /** Defaults to "floors" when the spec declares layers. */
  layers?: LayerMode;
  /** With a component, container or arrow selected, hide the arrows that do not belong to it instead of only dimming them. Off by default. */
  isolate?: boolean;
  /**
   * How arrows are drawn between cards. `"orthogonal"` (default): right-angle routes that go around the cards, each arrow with its own spot along the card's edge and arrows sharing a corridor side by side.
   * Waypoints (`via`) are ignored. `"straight"`: a straight line, bent only at the waypoints the spec gives (what earlier versions drew).
   */
  routing?: "straight" | "orthogonal";
  /**
   * How the mouse wheel acts over the diagram. `"ctrl"` (default): only Ctrl or Cmd + wheel (and a trackpad pinch) zooms; a plain wheel scrolls the page.
   * `"always"`: a plain wheel zooms towards the pointer, so the diagram captures the scroll. The page still scrolls when the pointer is outside the diagram,
   * when the diagram is at its fitted size and the wheel turns towards zooming out, at the zoom limits, and while Alt is held.
   */
  wheelZoom?: "ctrl" | "always";
  /** The request path, as component ids, which `declutter` keeps even when the path itself is not drawn. Defaults to `path`. */
  tracePath?: string[];
  /** Zoomed out far enough that arrows are hard to tell apart, show only the arrows on the traced path (or, with no trace, the ones not marked off the path). They return as you zoom in or point at something. Off by default. */
  declutter?: boolean;
  className?: string;
  /** Set `--adg-*` custom properties here to override the theme. */
  style?: CSSProperties;
};

type Mode = "top" | "iso";
type Hover = { kind: "node"; id: string } | { kind: "edge"; i: number } | null;

const FLOW = "flow";
const CHROME_H = 150; // the toolbar above the stage and the trace bar below it (with a little slack), so on a tall window all three fit on screen at once
const FLOORS_OVERFILL = 1.6; // how far past the height of the stage the floors view may be zoomed at first, to use its width
const DECLUTTER_BELOW = 0.5; // on-screen scale under which `declutter` hides the minor arrows
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.2; // the + and - buttons
const ABS_MAX_SCALE = 1.5; // a big diagram is fitted small, so its zoom limit also lets the drawing reach this real size (cards at ×1.5)
const MAX_ZOOM_CAP = 16;
const maxZoomFor = (fit: number) => Math.min(MAX_ZOOM_CAP, Math.max(MAX_ZOOM, fit > 0 ? ABS_MAX_SCALE / fit : MAX_ZOOM));
const clampZoom = (z: number, max = MAX_ZOOM) => Math.max(MIN_ZOOM, Math.min(max, z));
const ISO = { rx: 40, rz: -24 };
const PAN_STEP = 80; // px per press of a pan button
const ROTATE_STEP = 15; // degrees per press of a rotate button
const TILT_STEP = 10;
const CARD_LIFT = 200; // px of depth bias for the upright cards, more than the plane drops away across a card's height
const LEVEL_GLYPH: Record<Level, string> = { good: "✓", info: "i", warn: "▲", risk: "✕" };
const LEVEL_WORD: Record<Level, string> = { good: "Good", info: "Note", warn: "Warning", risk: "Risk" };

export const scaleText = (s: Scale) => (s.min === s.max ? `×${s.min}` : `×${s.min}–${s.max}`);
/**
 * A card's accessible name. It starts with the text a sighted visitor reads on the card, in order (WCAG 2.5.3, Label in Name,
 * so a voice-control user can say what they see), then adds what the layout and colour show but the words do not.
 */
const nodeName = (n: DiagramNode, fact: LensFact | undefined, level: Level, lensLabel: string, isSubShown: boolean, steps: number[], layerLabel?: string) => {
  const visible = [n.label, n.scale && scaleText(n.scale), fact ? fact.badge : isSubShown ? n.sub : undefined, ...n.icons.map((ic) => (typeof ic === "string" ? undefined : ic.label))].filter(Boolean).join(" ");
  // the sub-label is only drawn in the top view on a wide screen; when it is not, it still belongs in the name, after the visible text
  const extra = [!fact && !isSubShown && n.sub, n.peripheral && "peripheral", layerLabel && `layer ${layerLabel}`, n.plane && `${n.plane} plane`, steps.length > 0 && `trace step ${steps.join(" and ")}`, n.scale && `scales ${scaleText(n.scale)}${n.scale.unit ? ` ${n.scale.unit}` : ""}`, fact && `${lensLabel}: ${LEVEL_WORD[level]}`].filter(Boolean).join(", ");
  return extra ? `${visible}. ${extra}` : visible;
};

export function ArchDiagram({
  spec: fullSpec,
  iconPack = genericPack,
  selected,
  onSelect,
  traceNode = null,
  prevTraceNode = null,
  path,
  traceBar = null,
  reducedMotion,
  theme,
  onThemeChange,
  layers: layersProp,
  isolate = false,
  declutter = false,
  wheelZoom = "ctrl",
  routing = "orthogonal",
  tracePath,
  className,
  style,
}: ArchDiagramProps) {
  const uid = useId().replace(/:/g, "");
  const prefersReduced = useReducedMotion();
  const reduced = reducedMotion ?? prefersReduced;
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(0);
  const [userMode, setUserMode] = useState<Mode | null>(null);
  const [angles, setAngles] = useState(ISO);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  // True while a wheel or pinch zoom is going on: the plane then follows at once instead of easing over 0.9 s.
  const [isZooming, setIsZooming] = useState(false);
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [lens, setLens] = useState<string>(FLOW);
  const [hover, setHover] = useState<Hover>(null);
  const [selEdge, setSelEdge] = useState<number | null>(null);
  // A selected container (zone): its components, the arrows in and out of it, and the components at their other ends stay lit.
  const [selZone, setSelZone] = useState<string | null>(null);
  const [showTooling, setShowTooling] = useState(true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set()); // containers drawn as one card
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);
  const pulseRef = useRef<SVGGElement>(null);
  const dragMoved = useRef(false);
  // The latest zoom and pan, readable from handlers that outlive a render (wheel, pinch), and the fingers currently down.
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const isPinching = useRef(false);
  const maxZoomRef = useRef(MAX_ZOOM);
  const zoomAtRef = useRef<(target: number, from: [number, number]) => void>(() => {});

  const hasPeripheral = useMemo(() => fullSpec.nodes.some((n) => n.peripheral), [fullSpec]);
  // With tooling off, everything below is worked out again from what is left: the plane, zones, cables and zoom fit all shrink to it.
  const toolingSpec = useMemo(() => (showTooling ? fullSpec : withoutPeripherals(fullSpec)), [fullSpec, showTooling]);
  // Collapsed containers are one card each, worked out the same way: the layout, cables and fit all follow what is left.
  const spec = useMemo(() => collapseZones(toolingSpec, collapsed), [toolingSpec, collapsed]);
  const byId = useMemo(() => new Map(spec.nodes.map((n) => [n.id, n])), [spec]);
  const lenses = useMemo(() => [{ id: FLOW, label: "Flow", summary: spec.description ?? "" }, ...resolveLenses(spec)], [spec]);
  const lensDef = lenses.find((l) => l.id === lens) ?? lenses[0]!;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl or Cmd + wheel zooms towards the pointer; a trackpad pinch reaches the page as exactly that. By default a plain wheel keeps
  // scrolling the page, so an embedded diagram never traps someone scrolling past it; with `wheelZoom="always"` it zooms too, but lets
  // the page have it when the diagram is at its fitted size (wheel down), at a zoom limit, sideways, or with Alt held. Native listener: React's is passive.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const pinch = e.ctrlKey || e.metaKey;
      if (!pinch) {
        if (wheelZoom !== "always" || e.altKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        const z = zoomRef.current;
        if ((e.deltaY > 0 && z <= 1) || (e.deltaY < 0 && z >= maxZoomRef.current)) return; // nothing left to zoom that way: the page scrolls
      }
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const lines = e.deltaMode === 1 ? 33 : 1;
      const step = Math.max(-0.15, Math.min(0.15, -e.deltaY * lines * 0.003));
      setIsZooming(true);
      clearTimeout(zoomTimer.current);
      zoomTimer.current = setTimeout(() => setIsZooming(false), 160);
      zoomAtRef.current(zoomRef.current * Math.exp(step), [e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2)]);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const forget = (e: PointerEvent) => void pointers.current.delete(e.pointerId);
    window.addEventListener("pointerup", forget);
    window.addEventListener("pointercancel", forget);
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerup", forget);
      window.removeEventListener("pointercancel", forget);
    };
  }, [wheelZoom]);

  const portrait = stageW > 0 && stageW < 720;
  const mode: Mode = userMode ?? (portrait ? "top" : "iso");
  const layerList = spec.layers ?? [];
  const layerMode: LayerMode = layerList.length ? (layersProp ?? "floors") : "off";
  const floors = layerMode === "floors" && mode === "iso";
  const layout = useMemo(() => computeLayout(spec, portrait), [spec, portrait]);
  const { W, H, xy } = layout;
  const rx = mode === "iso" ? angles.rx : 0;
  const rz = mode === "iso" ? angles.rz : 0;

  // Height is fixed per orientation so switching views never moves the page. On a tall window the stage grows with it, so a big diagram is not squeezed into a strip.
  const [viewH, setViewH] = useState(0);
  useEffect(() => {
    const read = () => setViewH(window.innerHeight);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  const stageH = portrait ? Math.round(Math.min(1100, stageW * (H / W)) + 40) : Math.round(Math.min(1300, Math.max(Math.min(560, stageW * 0.5), viewH - CHROME_H)));

  // Cable geometry, label positions, and how each link is drawn. Entries stay index-aligned with spec.links.
  const links = useMemo(
    () => {
      const taken: Box[] = []; // chips placed so far, so a later chip steers clear of them
      if (routing === "orthogonal") {
        const floorOf = (layerId: string | undefined) => (floors && layerId !== undefined && layerList.some((l) => l.id === layerId) ? layerId : "");
        const geos = routeLinks(
          spec,
          layout,
          spec.links.map((l) => ({ twoWay: resolveLink(l).twoWay, toOtherFloor: floorOf(byId.get(l.from)?.layer) !== floorOf(byId.get(l.to)?.layer) })),
          floors ? (n) => floorOf(n.layer) : undefined,
          taken,
          mode === "top" ? "card" : floors ? "pedestal" : "plate",
        );
        return spec.links.map((l, i) => (geos[i] ? { l, r: resolveLink(l), g: geos[i]! } : null));
      }
      return spec.links.map((l) => {
        const r = resolveLink(l);
        const g = linkGeometry(spec, l, layout, r.twoWay, taken, mode === "top");
        return g ? { l, r, g } : null;
      });
    },
    [spec, layout, mode, routing, floors, byId, layerList],
  );

  // Parents first, so nested zones paint on top. Labels steer clear of cables and their chips.
  const zones = useMemo(
    () =>
      zoneRects(
        spec,
        layout,
        links.flatMap((x) => (x ? [{ pts: x.g.pts, mid: x.g.mid, label: x.l.label }] : [])),
      ).sort((a, b) => a.depth - b.depth),
    [spec, layout, links],
  );

  // With floors on, fit to what is drawn (cards with their name plates, bands, zones), not to the whole plate: the plate's empty margin and rotated
  // corners would leave the diagram small in the stage. `cx` and `cy` move the plane so that content sits in the middle.
  const bands = useMemo(() => bandRectsOf(spec, xy, W, H, portrait), [spec, xy, W, H, portrait]);
  const fitInfo = useMemo(() => {
    if (!stageW) return { fit: 1, bw: 0, bh: 0, cx: 0, cy: 0, headroom: 0 };
    if (floors) {
      const b = floorsBounds({ spec, xy, W, H, zones, bands, rx, rz });
      const [bw, bh] = [b.maxX - b.minX, b.maxY - b.minY];
      // Fill the stage's width. A tall stack may run a little past the top and bottom (up to FLOORS_OVERFILL times what would fit), reachable by panning.
      return { fit: Math.min((stageW * 0.99) / bw, ((stageH - 24) / bh) * FLOORS_OVERFILL), bw, bh, cx: (b.minX + b.maxX) / 2 - W / 2, cy: (b.minY + b.maxY) / 2 - H / 2, headroom: 24 };
    }
    const a = (rz * Math.PI) / 180;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [x, y] of [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]] as const) {
      xs.push(x * Math.cos(a) - y * Math.sin(a));
      ys.push((x * Math.sin(a) + y * Math.cos(a)) * Math.cos((rx * Math.PI) / 180));
    }
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    const headroom = mode === "iso" ? 150 : 24;
    return { fit: Math.min((stageW * 0.98) / bw, (stageH - headroom) / bh), bw, bh, cx: 0, cy: 0, headroom };
  }, [stageW, stageH, W, H, rx, rz, mode, floors, spec, xy, zones, bands]);
  const maxZoom = maxZoomFor(fitInfo.fit);
  maxZoomRef.current = maxZoom;
  const scale = fitInfo.fit * zoom;
  const wheelHint = wheelZoom === "always" ? "scroll or pinch to zoom · alt + scroll scrolls the page" : "ctrl + wheel or pinch to zoom";

  // Panning: the plane may travel until its far edge reaches the stage edge (plus a little slack), never further,
  // so zooming in can never leave a part of the diagram out of reach. When the plane fits, there is nothing to pan.
  const reach = (content: number, stage: number) => (content > stage ? (content - stage) / 2 + 40 : 0);
  const limitsFor = (z: number) => {
    const sc = fitInfo.fit * z;
    return { x: reach(fitInfo.bw * sc, stageW), y: reach(fitInfo.bh * sc + fitInfo.headroom, stageH) };
  };
  const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));
  const { x: limitX, y: limitY } = limitsFor(zoom);
  const panX = clamp(pan.x, limitX);
  const panY = clamp(pan.y, limitY);
  const canPan = limitX > 0 || limitY > 0;
  zoomRef.current = zoom;
  panRef.current = pan; // the wanted pan: it may lie outside what is drawn now, and keeps a zoom anchored once there is room

  // Zoom so the point under `from` (an offset in pixels from the stage centre) stays under it. The plane is
  // translated by the pan, then scaled about the stage centre, so the new pan follows from the zoom ratio alone.
  const zoomAt = (target: number, from: [number, number]) => {
    const z0 = zoomRef.current;
    const z1 = clampZoom(target, maxZoomRef.current);
    if (z1 === z0) return;
    const t = z1 / z0;
    const lift = mode === "iso" ? 30 : 0; // the plane sits 30 px lower in the isometric view
    const lim = limitsFor(maxZoomRef.current); // only bound it by the roomiest case; the drawn pan is clamped to the current zoom
    const next = {
      x: clamp(from[0] * (1 - t) + t * panRef.current.x, lim.x),
      y: clamp((from[1] - lift) * (1 - t) + t * panRef.current.y, lim.y),
    };
    zoomRef.current = z1;
    panRef.current = next;
    setZoom(z1);
    setPan(next);
  };
  zoomAtRef.current = zoomAt;

  const route = useMemo(() => findRoute(spec.links, prevTraceNode, traceNode), [spec, prevTraceNode, traceNode]);
  const routeSet = useMemo(() => new Set(route.map((r) => r.i)), [route]);

  // The static path: which step numbers each card carries, and which cables the whole route uses.
  const stepNumbers = useMemo(() => {
    const m = new Map<string, number[]>();
    (path ?? []).forEach((id, i) => m.set(id, [...(m.get(id) ?? []), i + 1]));
    return m;
  }, [path]);
  const pathLinks = useMemo(() => {
    const set = new Set<number>();
    const ids = (path ?? []).filter((id) => byId.has(id));
    for (let i = 1; i < ids.length; i++) for (const hop of findRoute(spec.links, ids[i - 1]!, ids[i]!)) set.add(hop.i);
    return set;
  }, [path, spec, byId]);

  // Which components each container holds, including those of the containers nested inside it.
  const zoneMembers = useMemo(() => {
    const zs = spec.zones ?? [];
    const out = new Map<string, Set<string>>(zs.map((z) => [z.id, new Set((z.members ?? []).filter((m) => byId.has(m)))]));
    for (const z of zs) {
      let up = z.parent;
      for (let guard = 0; up && guard < 20; guard++) {
        for (const m of out.get(z.id) ?? []) out.get(up)?.add(m);
        up = zs.find((q) => q.id === up)?.parent;
      }
    }
    return out;
  }, [spec, byId]);

  // A selected container lights what is inside it, every arrow with an end inside, and the components at the far ends of those arrows.
  const zoneFocus = useMemo(() => {
    const inside = selZone ? zoneMembers.get(selZone) : undefined;
    if (!inside?.size) return null;
    const lit = new Set<number>();
    const nodes = new Set(inside);
    spec.links.forEach((l, i) => {
      if (inside.has(l.from) || inside.has(l.to)) {
        lit.add(i);
        nodes.add(l.from);
        nodes.add(l.to);
      }
    });
    return { lit, nodes };
  }, [spec, selZone, zoneMembers]);

  // The arrows on the request path, kept when `declutter` hides the rest (the drawn path, or the trace given for it).
  const keptPath = useMemo(() => {
    const set = new Set<number>();
    const ids = (tracePath ?? path ?? []).filter((id) => byId.has(id));
    for (let i = 1; i < ids.length; i++) for (const hop of findRoute(spec.links, ids[i - 1]!, ids[i]!)) set.add(hop.i);
    return set;
  }, [tracePath, path, spec, byId]);

  // Hover focus: which cables / components stay lit while everything else dims. Pointing at something wins over a selected container.
  const focus = useMemo(() => {
    if (!hover) return zoneFocus;
    const lit = new Set<number>();
    const nodes = new Set<string>();
    if (hover.kind === "edge") {
      const l = spec.links[hover.i];
      lit.add(hover.i);
      if (l) [l.from, l.to].forEach((id) => nodes.add(id));
    } else {
      nodes.add(hover.id);
      spec.links.forEach((l, i) => {
        if (l.from === hover.id || l.to === hover.id) {
          lit.add(i);
          nodes.add(l.from);
          nodes.add(l.to);
        }
      });
    }
    return { lit, nodes };
  }, [hover, spec, zoneFocus]);

  // Cables touching the selected component stay emphasised.
  const selLinks = useMemo(() => {
    if (selEdge !== null) return new Set([selEdge]);
    const s = new Set<number>();
    spec.links.forEach((l, i) => {
      if (selected && (l.from === selected || l.to === selected)) s.add(i);
    });
    return s;
  }, [spec, selected, selEdge]);

  // Pulse travelling along the cables between the previous and current trace component.
  useEffect(() => {
    const pulse = pulseRef.current;
    if (!pulse) return;
    const node = traceNode ? byId.get(traceNode) : undefined;
    if (!node) {
      pulse.style.opacity = "0";
      return;
    }
    const place = (x: number, y: number) => {
      pulse.setAttribute("transform", `translate(${x} ${y})`);
      pulse.style.opacity = "1";
    };
    const paths = route.map((r) => pathRefs.current[r.i]);
    const lens = paths.map((p) => p?.getTotalLength() ?? 0);
    const total = lens.reduce((s, n) => s + n, 0);
    if (reduced || !total) {
      const [x, y] = xy(node.at.col, node.at.row);
      place(x, y);
      return;
    }
    const duration = Math.max(700, (total / 420) * 1000);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const e = k * k * (3 - 2 * k);
      let dist = e * total;
      let idx = 0;
      while (idx < lens.length - 1 && dist > lens[idx]!) {
        dist -= lens[idx]!;
        idx++;
      }
      const p = paths[idx];
      if (p) {
        const at = route[idx]!.forward ? dist : lens[idx]! - dist;
        const pt = p.getPointAtLength(Math.max(0, Math.min(lens[idx]!, at)));
        place(pt.x, pt.y);
      }
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [route, traceNode, reduced, xy, byId]);

  // Drag pans in both views. In the isometric view shift-drag or right-drag rotates it (two fingers twisting does on a touch screen; the buttons always do).
  // A drag must not also count as a click on a component.
  const onPointerDown = (ev: ReactPointerEvent) => {
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.current.size === 2) return startPinch();
    if (pointers.current.size > 2) return;
    const wantsRotate = mode === "iso" && ((ev.button === 0 && ev.shiftKey) || ev.button === 2);
    const wantsPan = !wantsRotate && (ev.button === 1 || (ev.button === 0 && !ev.shiftKey));
    if ((!wantsPan && !wantsRotate) || (wantsPan && !canPan)) return;
    if (ev.button === 1 || ev.button === 2) ev.preventDefault();
    const sx = ev.clientX;
    const sy = ev.clientY;
    const base = { ...angles };
    const basePan = { x: panX, y: panY };
    dragMoved.current = false;
    const move = (e: PointerEvent) => {
      if (isPinching.current || e.pointerId !== ev.pointerId) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!dragMoved.current && Math.hypot(dx, dy) < 6) return;
      dragMoved.current = true;
      setDragging(true);
      if (wantsPan) setPan({ x: clamp(basePan.x + dx, limitX), y: clamp(basePan.y + dy, limitY) });
      else setAngles({ rz: base.rz + dx * 0.4, rx: Math.max(30, Math.min(75, base.rx - dy * 0.3)) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // Two fingers: zoom by the change in their distance and follow their midpoint, so the content between them stays between them.
  const startPinch = () => {
    const el = stageRef.current;
    const [a, b] = [...pointers.current.values()];
    if (!el || !a || !b) return;
    const rect = el.getBoundingClientRect();
    const centre = (p: { x: number; y: number }, q: { x: number; y: number }): [number, number] => [(p.x + q.x) / 2 - (rect.left + rect.width / 2), (p.y + q.y) / 2 - (rect.top + rect.height / 2)];
    const turnOf = (p: { x: number; y: number }, q: { x: number; y: number }) => (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    const start = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: centre(a, b), zoom: zoomRef.current, pan: { ...panRef.current }, turn: turnOf(a, b), angles: { ...anglesRef.current } };
    const lift = mode === "iso" ? 30 : 0;
    isPinching.current = true;
    setIsZooming(true);
    dragMoved.current = true; // the fingers going down must not also click a component
    const move = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [p, q] = [...pointers.current.values()];
      if (!p || !q) return;
      const z1 = clampZoom((start.zoom * Math.hypot(p.x - q.x, p.y - q.y)) / start.dist, maxZoomRef.current);
      const t = z1 / start.zoom;
      const mid = centre(p, q);
      const lim = limitsFor(maxZoomRef.current);
      const next = {
        x: clamp(start.mid[0] * (1 - t) + t * start.pan.x + (mid[0] - start.mid[0]), lim.x),
        y: clamp((start.mid[1] - lift) * (1 - t) + t * start.pan.y + (mid[1] - start.mid[1]), lim.y),
      };
      zoomRef.current = z1;
      panRef.current = next;
      setZoom(z1);
      setPan(next);
      if (mode === "iso") {
        const twist = ((((turnOf(p, q) - start.turn) % 360) + 540) % 360) - 180; // the isometric view turns with the fingers
        setAngles({ rz: start.angles.rz + twist, rx: start.angles.rx });
      }
    };
    const end = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size >= 2) return;
      isPinching.current = false;
      setIsZooming(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  // Arrow keys pan while the stage itself has focus (not a card), moving the view the way scrolling does.
  // The buttons that do what dragging does (WCAG 2.5.7: anything done by dragging also works with a single press).
  const nudgePan = (dx: number, dy: number) => setPan({ x: clamp(panX + dx, limitX), y: clamp(panY + dy, limitY) });
  // In the floors view every floor and card is placed by script, so a turn is eased by script too: a CSS transition would slide the plane for 0.9 s
  // while the floors and cards jumped to their new places, and the diagram would not hold together while it moved.
  const anglesRef = useRef(angles);
  anglesRef.current = angles;
  const turn = useRef<{ raf?: number; to: { rz: number; rx: number } }>({ to: angles });
  useEffect(() => () => { if (turn.current.raf) cancelAnimationFrame(turn.current.raf); }, []);
  const rotateBy = (dz: number, dTilt: number) => {
    const base = turn.current.raf ? turn.current.to : anglesRef.current; // a press during a turn adds to where the turn is heading
    const to = { rz: base.rz + dz, rx: Math.max(30, Math.min(75, base.rx + dTilt)) };
    if (!floors || reduced) {
      setAngles(to);
      return;
    }
    turn.current.to = to;
    const from = anglesRef.current;
    const t0 = performance.now();
    if (turn.current.raf) cancelAnimationFrame(turn.current.raf);
    setIsZooming(true);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 260);
      const e = 1 - Math.pow(1 - k, 3);
      setAngles({ rz: from.rz + (to.rz - from.rz) * e, rx: from.rx + (to.rx - from.rx) * e });
      if (k < 1) turn.current.raf = requestAnimationFrame(step);
      else {
        turn.current.raf = undefined;
        setIsZooming(false);
      }
    };
    turn.current.raf = requestAnimationFrame(step);
  };

  // A card or chip reached by keyboard is brought into view when zoom or pan has moved it away (the stage is overflow:hidden, so the
  // browser's own scroll-into-view would shift its contents instead; we hold that still and pan).
  const revealFocused = (el: HTMLElement) => {
    const stage = stageRef.current;
    if (!stage || !el.matches(":focus-visible")) return;
    stage.scrollLeft = 0;
    stage.scrollTop = 0;
    const s = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const margin = 32;
    const dx = r.left < s.left + margin ? s.left + margin - r.left : r.right > s.right - margin ? s.right - margin - r.right : 0;
    const dy = r.top < s.top + margin ? s.top + margin - r.top : r.bottom > s.bottom - margin ? s.bottom - margin - r.bottom : 0;
    if (dx || dy) setPan({ x: clamp(panX + dx, limitX), y: clamp(panY + dy, limitY) });
  };

  const onKeyDown = (ev: ReactKeyboardEvent) => {
    // Escape dismisses what hover or focus has lit up (WCAG 1.4.13) without moving the pointer or the focus.
    if (ev.key === "Escape") setHover(null);
    if (ev.target !== ev.currentTarget) return;
    if (ev.key === "+" || ev.key === "=" || ev.key === "-") {
      ev.preventDefault();
      zoomAt(zoomRef.current * (ev.key === "-" ? 1 / ZOOM_STEP : ZOOM_STEP), [0, 0]);
      return;
    }
    if (!canPan) return;
    const step = 60;
    const move: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = move[ev.key];
    if (!d) return;
    ev.preventDefault();
    setPan({ x: clamp(panX + d[0], limitX), y: clamp(panY + d[1], limitY) });
  };

  const guardDrag = () => {
    if (dragMoved.current) {
      dragMoved.current = false;
      return true;
    }
    return false;
  };
  const chooseNode = (id: string) => {
    if (guardDrag()) return;
    setSelEdge(null);
    setSelZone(null);
    onSelect(id);
  };
  const chooseEdge = (i: number) => {
    if (guardDrag()) return;
    setSelZone(null);
    setSelEdge((cur) => (cur === i ? null : i));
  };
  const chooseZone = (id: string) => {
    if (guardDrag()) return;
    setSelEdge(null);
    onSelect(null);
    setSelZone((cur) => (cur === id ? null : id));
  };
  // Collapse or expand one container, or every innermost one at once (the ones with two or more components).
  const resetPicks = () => {
    setHover(null);
    setSelEdge(null);
    setSelZone(null);
    onSelect(null);
  };
  const foldZone = (id: string, fold: boolean) => {
    resetPicks();
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (fold) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const levels = useMemo(() => collapseLevels(toolingSpec), [toolingSpec]);
  const levelNow = collapsed.size === 0 ? "open" : String(levels.findIndex((l) => l.size === collapsed.size && [...l].every((id) => collapsed.has(id))) + 1 || "custom");
  const chooseLevel = (v: string) => {
    resetPicks();
    setCollapsed(v === "open" ? new Set() : (levels[Number(v) - 1] ?? new Set()));
  };
  const setView = (m: Mode) => {
    setUserMode(m);
    if (m === "iso") setAngles(ISO);
  };

  const planeTransform = `translate(${panX}px, ${panY}px) translateY(${mode === "iso" ? 30 : 0}px) scale(${scale})${floors ? ` translate(${-fitInfo.cx}px, ${-fitInfo.cy}px)` : ` rotateX(${rx}deg) rotateZ(${rz}deg)`}`;
  // translateZ moves each upright card towards the viewer along its own axis. With no perspective that changes nothing on screen, but it puts
  // the card in front of the plane's pedestals while the plane turns, instead of letting the pedestals pass over it.
  const counter = `rotateZ(${-rz}deg) rotateX(${-rx}deg) translateZ(${CARD_LIFT}px)`;

  // What the info strip describes: hover first, then a selected cable, then the selected component, else the lens overview.
  const infoEdge = hover?.kind === "edge" ? hover.i : hover?.kind !== "node" && selEdge !== null ? selEdge : null;
  const infoNodeId = infoEdge !== null ? null : hover?.kind === "node" ? hover.id : selected;
  const edgeInfo = infoEdge !== null ? links[infoEdge] : null;
  // A selected container is described unless something else is being pointed at.
  const infoZone = infoEdge === null && hover?.kind !== "node" && selZone ? spec.zones?.find((z) => z.id === selZone) : undefined;
  const zoneInside = infoZone ? zoneMembers.get(infoZone.id) : undefined;
  const zoneCrossing = zoneInside ? spec.links.filter((l) => zoneInside.has(l.from) !== zoneInside.has(l.to)) : [];
  const nodeInfo = infoNodeId ? byId.get(infoNodeId) : undefined;

  const used = {
    async: links.some((x) => x?.r.interaction === "async"),
    twoWay: links.some((x) => x?.r.twoWay),
    off: links.some((x) => x?.r.offPath),
    dep: links.some((x) => x?.r.pattern === "dependency"),
    scale: spec.nodes.some((n) => n.scale),
    periph: hasPeripheral && showTooling,
    ingress: links.some((x) => x?.l.traffic === "ingress"),
    egress: links.some((x) => x?.l.traffic === "egress"),
  };

  // The pack's attribution is shown only when one of its own icons is on the diagram (a fallback to the generic pack does not count).
  const attribution = iconPack.attribution && spec.nodes.some((n) => n.icons.some((ic) => iconPack.resolve(typeof ic === "string" ? ic : ic.icon))) ? iconPack.attribution : null;
  const marker = (kind: "a" | "h", state: string) => `url(#${uid}-${kind}${state})`;

  // ---- layers: bands in the flat view, floors in the isometric one -------------------------------------------------------------
  const showBands = layerMode === "floors" && mode === "top";
  const layerIndex = new Map(layerList.map((l, i) => [l.id, i]));
  /** Height of a layer's floor. The top layer is highest; a card with no layer stands on the ground. */
  const elevOf = (layerId: string | undefined) => (floors ? layerHeight(spec, layerId) : 0);
  /** Which floor a thing is drawn on: the layer id, or "" for the ground. Everything is on the ground unless floors are on. */
  const floorKey = (layerId: string | undefined) => (floors && layerId !== undefined && layerIndex.has(layerId) ? layerId : "");
  const floorKeys = floors ? ["", ...[...layerList].reverse().map((l) => l.id)] : [""]; // ground, then the lowest floor up, so a higher floor is drawn over a lower one
  const bandRects = bands;
  // A zone sits on the floor of its members (or of what is inside it).
  const zoneLayer = zoneLayers(spec);
  type LinkEntry = NonNullable<(typeof links)[number]>;
  // Floors are drawn without the browser's 3D sorting (it paints overlapping tilted layers over upright cards): each floor is a flat layer under a 2D
  // matrix, and a card goes at its projected screen position, so what is in front is just document order. `proj` is that projection: rotate about the
  // plane's centre, squash by cos(tilt), then lift by the floor's height times sin(tilt).
  const { proj, matrix: floorMatrix } = projector(W, H, rx, rz);
  // On floors a card nearer the viewer must cover one behind it: lower floors first, and within a floor from the back (top of the screen) to the front.
  const paintOrder = floors ? [...spec.nodes].sort((a, b) => elevOf(a.layer) - elevOf(b.layer) || proj(...xy(a.at.col, a.at.row), 0)[1] - proj(...xy(b.at.col, b.at.row), 0)[1]) : spec.nodes;
  // An arrow between two floors starts on its source card and runs along the source's own floor to the point directly above or below the target,
  // then rises or drops vertically (always vertical on screen, so it is easy to follow) into the target card. Both ends are real cards.
  // `corner` is where it turns, `tip` where the arrowhead sits: just below the target when it arrives from underneath, above its name plate when it comes from above.
  const crossLinks = floors
    ? links.flatMap((x, i) => {
        if (!x) return [];
        const a = byId.get(x.l.from);
        const b = byId.get(x.l.to);
        if (!a || !b || floorKey(a.layer) === floorKey(b.layer)) return [];
        const [xt, yt] = xy(b.at.col, b.at.row);
        const down = elevOf(a.layer) > elevOf(b.layer);
        const corner = proj(xt, yt, elevOf(a.layer));
        const land = proj(xt, yt, elevOf(b.layer));
        const tip: [number, number] = [land[0], land[1] + (down ? -118 : 34)];
        // the part along the source's floor: its route, carried on to the target's footprint instead of stopping at the target's edge
        const along = roundedPath([...x.g.pts.slice(0, -1), [xt, yt]]);
        return [{ i, x, corner, tip, down, along }];
      })
    : [];
  const planeFact = (plane: Plane | undefined): LensFact | undefined =>
    plane === "control" ? { badge: "Control plane", level: "info", text: "Configures and governs the system: policy, configuration, provisioning." } : plane === "data" ? { badge: "Data plane", level: "good", text: "Carries the system's work for its users." } : undefined;
  const nodeFact = (n: DiagramNode): LensFact | undefined => (lens === FLOW ? undefined : lens === "planes" ? planeFact(n.plane) : n.lenses?.[lens]);
  const linkFact = (l: DiagramLink): LensFact | undefined => (lens === FLOW ? undefined : lens === "planes" ? planeFact(l.plane) : l.lenses?.[lens]);

  const markerDefs = () => (
    <defs>
      {(
        [
          ["", "var(--adg-accent)"],
          ["-on", "var(--adg-hot)"],
          ["-dim", "var(--adg-accent-dim)"],
          ["-good", "var(--adg-good)"],
          ["-info", "var(--adg-info)"],
          ["-warn", "var(--adg-warn)"],
          ["-risk", "var(--adg-risk)"],
        ] as const
      ).map(([state, color]) => (
        <g key={state}>
          <marker id={`${uid}-a${state}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="12" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            <path d="M0 0 L10 5 L0 10 z" style={{ fill: color }} />
          </marker>
          <marker id={`${uid}-h${state}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="12" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            <path d="M1 1 L9 5 L1 9 z" style={{ fill: "var(--adg-bg)", stroke: color }} strokeWidth="1.6" strokeLinejoin="round" />
          </marker>
        </g>
      ))}
    </defs>
  );
  /** One cable along `d`. `keepRef` hands the path to the trace pulse, which only runs when everything is on one plane. */
  const crossIdx = new Set(crossLinks.map((c) => c.i));
  /** How a cable looks right now. A cable between floors (or off the request path) steps back until it is pointed at, selected, traced or next to the card in focus. */
  // `isolate`: with something selected, only its arrows stay. `declutter`: zoomed out, only the traced path stays. Pointing at an arrow's component always shows it.
  const isolateKeep = !isolate ? null : selEdge !== null ? new Set([selEdge]) : selZone && zoneFocus ? zoneFocus.lit : selected ? selLinks : null;
  const declutterOn = declutter && scale < DECLUTTER_BELOW;
  const hasPath = keptPath.size > 0;
  const hiddenOf = (x: LinkEntry, i: number) =>
    !(focus?.lit.has(i) ?? false) && !routeSet.has(i) &&
    ((isolateKeep !== null && !isolateKeep.has(i)) || (declutterOn && !(keptPath.has(i) || pathLinks.has(i) || selLinks.has(i) || selEdge === i || (!hasPath && !x.r.offPath))));
  const stateOf = (x: LinkEntry, i: number) => {
    const hot = (focus?.lit.has(i) ?? false) || routeSet.has(i) || pathLinks.has(i);
    // while one arrow is selected (and nothing is pointed at), every other arrow steps back, so the selected one can be read on its own
    const dim = focus !== null ? !focus.lit.has(i) : selEdge !== null && selEdge !== i && !routeSet.has(i) && !pathLinks.has(i);
    return { hot, dim, quiet: (x.r.offPath || crossIdx.has(i)) && !hot && !selLinks.has(i), level: linkFact(x.l)?.level, hid: hiddenOf(x, i) };
  };
  const cableEl = (x: LinkEntry, i: number, d: string, keepRef: boolean) => {
    const { l, r } = x;
    const { hot, dim, quiet, level, hid } = stateOf(x, i);
    const hollow = r.interaction === "async";
    const dep = r.pattern === "dependency";
    const m = dep || floors ? undefined : marker(hollow ? "h" : "a", hot ? "-on" : level ? `-${level}` : markerState(hot, r.offPath)); // floors draw their heads in a layer above the cards, so a card never hides one
    return (
      <g key={`${l.from}-${l.to}-${i}`} className={`adg-edge${level ? ` lv-${level}` : ""}${dim ? " dim" : ""}${quiet ? " quiet" : ""}${hid ? " hid" : ""}`}>
        <path
          ref={
            keepRef
              ? (el) => {
                  pathRefs.current[i] = el;
                }
              : undefined
          }
          d={d}
          className={`adg-edge-base${dep ? " dep" : hollow ? " async" : r.offPath ? " off" : ""}${selLinks.has(i) ? " sel" : ""}${hot ? " hot" : ""}`}
          markerEnd={m}
          markerStart={r.twoWay ? m : undefined}
        />
        {!r.offPath && !dep && <path d={d} className={`adg-edge-flow${hollow ? " async" : ""}${hot ? " hot" : ""}${selLinks.has(i) ? " sel" : ""}`} />}
        <path d={d} className="adg-hit" onPointerEnter={() => setHover({ kind: "edge", i })} onPointerLeave={() => setHover(null)} onClick={() => chooseEdge(i)} />
      </g>
    );
  };
  /** The card's title block (name, fleet badge, lens badge or sub-label). Drawn inside the card, and again in the titles layer above all cards when floors are on. */
  const labelEl = (n: DiagramNode, fact: LensFact | undefined, level: Level) => (
    <span className="adg-label">
                      <span className="adg-name">{n.label}</span>{" "}
                      {/* the spaces between these spans are not drawn (flex items), but make the card's text read as words */}
                      {n.scale && <span className="adg-scale">{scaleText(n.scale)}</span>}{" "}
                      {fact ? (
                        <span className={`adg-badge lv-${level}`}>
                          <i aria-hidden="true">{LEVEL_GLYPH[level]}</i>
                          {fact.badge}
                        </span>
                      ) : (
                        n.sub && !portrait && mode === "top" && <span className="adg-sub">{n.sub}</span>
                      )}
                    </span>
  );
  /** The card's icon frame. The titles layer draws one too, hidden, so its title lands where the real card's does. */
  const frameEl = (n: DiagramNode, step: boolean) => (
    <span className={`adg-frame${n.scale ? " stack" : ""}`} data-step={step ? stepNumbers.get(n.id)?.join(", ") : undefined}>
                      {n.icons.map((ic, k) => {
                        const key = typeof ic === "string" ? ic : ic.icon;
                        const caption = typeof ic === "string" ? undefined : ic.label;
                        const def = resolveIcon(iconPack, key);
                        return (
                          <span key={`${key}-${k}`} className="adg-ic">
                            {def.src ? (
                              <img className={`adg-icon${def.tile === "glyph" ? " glyph" : ""}`} src={def.src} alt="" width={TILE} height={TILE} draggable={false} />
                            ) : (
                              <svg className={`adg-icon${def.tile === "glyph" ? " glyph" : ""}`} viewBox="0 0 64 64" width={TILE} height={TILE} aria-hidden="true" focusable="false">
                                {def.svg}
                              </svg>
                            )}
                            {caption && (
                              <>
                                {" "}
                                <span className="adg-cap2">{caption}</span>
                              </>
                            )}
                          </span>
                        );
                      })}
                    </span>
  );
  const markerState = (hot: boolean, off: boolean) => (hot ? "-on" : off ? "-dim" : "");

  return (
    <div className={`adg${iconPack.unmodified ? " unmod" : ""}${className ? ` ${className}` : ""}`} style={{ ...themeStyle(theme), ...style }}>
      <style>{DIAGRAM_CSS}</style>

      <div className="adg-bar">
        <div className="adg-seg" role="group" aria-label="Diagram view">
          <button type="button" className="adg-btn" aria-pressed={mode === "top"} onClick={() => setView("top")}>Top view</button>
          <button type="button" className="adg-btn" aria-pressed={mode === "iso"} onClick={() => setView("iso")}>Isometric</button>
        </div>
        <span className="adg-cap" id={`${uid}-lens`}>Lens</span>
        {lenses.length <= 4 ? (
          <div className="adg-seg" role="group" aria-labelledby={`${uid}-lens`}>
            {lenses.map((l) => (
              <button key={l.id} type="button" className="adg-btn" aria-pressed={lens === l.id} onClick={() => setLens(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        ) : (
          <select className="adg-select" aria-labelledby={`${uid}-lens`} value={lens} onChange={(e) => setLens(e.target.value)}>
            {lenses.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        )}
        <div className="adg-seg adg-tool" role="group" aria-label="Zoom">
          <button type="button" className="adg-btn" aria-label="Zoom out" onClick={() => zoomAt(zoomRef.current / ZOOM_STEP, [0, 0])}>−</button>
          <button type="button" className="adg-btn" aria-label="Zoom in" onClick={() => zoomAt(zoomRef.current * ZOOM_STEP, [0, 0])}>+</button>
        </div>
        <div className="adg-seg adg-tool" role="group" aria-label="Pan">
          {(
            [
              ["Pan left", "←", 1, 0],
              ["Pan up", "↑", 0, 1],
              ["Pan down", "↓", 0, -1],
              ["Pan right", "→", -1, 0],
            ] as const
          ).map(([label, glyph, dx, dy]) => (
            <button key={label} type="button" className="adg-btn icon" aria-label={label} title={label} disabled={!canPan} onClick={() => nudgePan(dx * PAN_STEP, dy * PAN_STEP)}>
              {glyph}
            </button>
          ))}
        </div>
        {mode === "iso" && (
          <div className="adg-seg adg-tool" role="group" aria-label="Rotate">
            {(
              [
                ["Rotate left", "↺", -ROTATE_STEP, 0],
                ["Rotate right", "↻", ROTATE_STEP, 0],
                ["Tilt up", "⇡", 0, TILT_STEP],
                ["Tilt down", "⇣", 0, -TILT_STEP],
              ] as const
            ).map(([label, glyph, dz, dTilt]) => (
              <button key={label} type="button" className="adg-btn icon" aria-label={label} title={label} onClick={() => rotateBy(dz, dTilt)}>
                {glyph}
              </button>
            ))}
          </div>
        )}
        {levels.length > 0 && (
          <>
            <span className="adg-cap" id={`${uid}-detail`}>Detail</span>
            <select className="adg-select" aria-labelledby={`${uid}-detail`} value={levelNow} onChange={(e) => chooseLevel(e.target.value)}>
              <option value="open">All components</option>
              {levels.map((_, i) => (
                <option key={i} value={String(i + 1)}>
                  {levels.length === 1 ? "Containers as cards" : `Level ${i + 1} of ${levels.length}${i === 0 ? " (outermost)" : i === levels.length - 1 ? " (innermost)" : ""}`}
                </option>
              ))}
              {levelNow === "custom" && <option value="custom" disabled>Custom</option>}
            </select>
          </>
        )}
        {hasPeripheral && (
          <button type="button" className="adg-btn adg-tool" aria-pressed={showTooling} onClick={() => {
              const next = !showTooling;
              setShowTooling(next);
              setHover(null);
              setSelEdge(null);
              setSelZone(null);
              if (!next && selected && fullSpec.nodes.find((n) => n.id === selected)?.peripheral) onSelect(null);
            }}
          >
            Tooling
          </button>
        )}
        <button
          type="button"
          className="adg-btn adg-tool"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
            setAngles(ISO);
            setSelEdge(null);
            setSelZone(null);
            onSelect(null);
          }}
        >
          Reset
        </button>
        {onThemeChange && (
          <>
            <span className="adg-cap" id={`${uid}-theme`}>Theme</span>
            <select className="adg-select" aria-labelledby={`${uid}-theme`} value={getTheme(theme).id} onChange={(e) => onThemeChange(e.target.value)}>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
              {typeof theme === "object" && !THEMES.some((t) => t.id === theme.id) && <option value={theme.id}>{theme.label}</option>}
            </select>
          </>
        )}
        <span className="adg-grow" />
        <span className="adg-hint">
          {mode === "iso"
            ? `${canPan ? "Drag to pan · " : ""}shift-drag or right-drag to rotate · ${wheelHint}`
            : `${canPan ? "Drag to pan · " : ""}${wheelHint}`}
        </span>
      </div>

      <div
        ref={stageRef}
        className={`adg-view${mode === "iso" ? " iso" : ""}${canPan ? " pan" : ""}${dragging ? " drag" : ""}`}
        style={{ height: stageH, touchAction: canPan ? "none" : undefined }}
        role="group"
        aria-label={canPan ? "Diagram viewport. Plus and minus zoom, arrow keys pan." : "Diagram viewport. Plus and minus zoom."}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => { if (mode === "iso") e.preventDefault(); }}
        onKeyDown={onKeyDown}
      >
        {stageW > 0 && (
          <div
            className={`adg-plane${floors ? " flat2d" : ""}${dragging || isZooming ? " nt" : ""}`}
            style={{ width: W, height: H, marginLeft: -W / 2, marginTop: -H / 2, transform: planeTransform, transformOrigin: `${W / 2}px ${H / 2}px`, ["--adg-k" as string]: 1 / scale } as CSSProperties}
          >
            {floorKeys.map((key) => (
              <div key={key || "ground"} className={key ? "adg-floor" : "adg-flat"} style={floors ? { transform: floorMatrix(elevOf(key || undefined)) } : undefined}>
                {key === "" && showBands && bandRects.map((b) => (
                  <div key={b.id} className={`adg-band${b.i % 2 ? " alt" : ""}`} style={{ left: b.left, top: b.top, width: b.width, height: b.height }}>
                    <span className="adg-band-label">{b.label}</span>
                  </div>
                ))}
                {key !== "" && bandRects.filter((b) => b.id === key).map((b) => (
                  <div key={b.id} className="adg-band floor" style={{ left: b.left, top: b.top, width: b.width, height: b.height }}>
                    <span className="adg-band-label">{b.label}</span>
                  </div>
                ))}
                {zones.filter((z) => floorKey(zoneLayer.get(z.id)) === key).map((z) => (
                  <div key={z.id} className={`adg-zone k-${z.kind}${selZone === z.id ? " sel" : ""}`} style={{ left: z.left, top: z.top, width: z.width, height: z.height }}>
                    {zoneMembers.get(z.id)?.size ? (
                      <div className="adg-zone-head" style={{ left: z.labelLeft, top: z.labelTop }}>
                      <button
                        type="button"
                        className="adg-zone-label"
                        aria-pressed={selZone === z.id}
                        aria-label={`${z.label}: ${zoneMembers.get(z.id)!.size} components. Highlight them and the arrows in and out.`}
                        onClick={() => chooseZone(z.id)}
                      >
                        {iconPack.zone?.(z.kind, 28)}
                        {z.label}
                      </button>
                      {zoneMembers.get(z.id)!.size >= 2 && (
                        <button type="button" className="adg-zone-fold" aria-label={`Collapse ${z.label} into one card`} title={`Collapse ${z.label} into one card`} onClick={() => foldZone(z.id, true)}>
                          −
                        </button>
                      )}
                      </div>
                    ) : (
                      <span className="adg-zone-label" style={{ left: z.labelLeft, top: z.labelTop, bottom: "auto" }}>
                        {iconPack.zone?.(z.kind, 28)}
                        {z.label}
                      </span>
                    )}
                  </div>
                ))}
                <svg className="adg-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                  {markerDefs()}
                  {links.map((x, i) => {
                    if (!x) return null;
                    if (floors && floorKey(byId.get(x.l.from)?.layer) !== key) return null; // an arrow runs along the floor it leaves from
                    return cableEl(x, i, crossLinks.find((c) => c.i === i)?.along ?? x.g.d, true);
                  })}
                  {!floors && (
                    <g ref={pulseRef} className="adg-pulse" style={{ opacity: 0 }}>
                      <circle className="adg-pulse-halo" r="18" />
                      <circle className="adg-pulse-core" r="8" />
                    </g>
                  )}
                </svg>
                {spec.nodes.filter((n) => floorKey(n.layer) === key).map((n) => {
                  const [x, y] = xy(n.at.col, n.at.row);
                  const dim = focus !== null && !focus.nodes.has(n.id);
                  return (
                    <div
                      key={n.id}
                      className={`adg-pad${n.peripheral ? " periph" : ""}${n.icons.length > 1 ? " wide" : ""}${selected === n.id ? " sel" : ""}${traceNode === n.id ? " lit" : ""}${dim ? " dim" : ""}`}
                      style={{ left: x, top: y }}
                    />
                  );
                })}
              </div>
            ))}

            {floors && (
              <svg className="adg-svg adg-cross" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
                {markerDefs()}
                {crossLinks.map((c) => cableEl(c.x, c.i, `M${c.corner[0]} ${c.corner[1]} L${c.tip[0]} ${c.tip[1]}`, false))}
              </svg>
            )}

            {paintOrder.map((n) => {
              const [x, y] = xy(n.at.col, n.at.row);
              const isSel = selected === n.id;
              const lift = mode === "iso" ? 8 + (isSel ? 8 : 0) : 0;
              const dim = focus !== null && !focus.nodes.has(n.id);
              const fact = nodeFact(n);
              const level = fact?.level ?? "info";
              return (
                <div key={n.id} className="adg-anchor" style={floors ? { left: proj(x, y, elevOf(n.layer))[0], top: proj(x, y, elevOf(n.layer))[1], transform: "none" } : { left: x, top: y, transform: counter }}>
                  <button
                    type="button"
                    className={`adg-card${n.peripheral ? " periph" : ""}${isSel ? " sel" : ""}${traceNode === n.id ? " lit" : ""}${dim ? " dim" : ""}`}
                    style={{ ["--ty" as string]: mode === "iso" ? `${-lift}px` : `${(TILE + 16) / 2}px` } as CSSProperties}
                    aria-pressed={isSel}
                    aria-label={nodeName(n, fact, level, lensDef.label, !portrait && mode === "top", stepNumbers.get(n.id) ?? [], layerList.find((l) => l.id === n.layer)?.label)}
                    aria-describedby={`${uid}-d-${n.id}`}
                    onPointerEnter={() => setHover({ kind: "node", id: n.id })}
                    onPointerLeave={() => setHover(null)}
                    onFocus={(ev) => {
                      setHover({ kind: "node", id: n.id });
                      revealFocused(ev.currentTarget);
                    }}
                    onBlur={() => setHover(null)}
                    onClick={() => chooseNode(n.id)}
                  >
                    {labelEl(n, fact, level)}{" "}
                    {frameEl(n, true)}
                  </button>
                </div>
              );
            })}

            {floors &&
              paintOrder.map((n) => {
                const [x, y] = xy(n.at.col, n.at.row);
                const [px, py] = proj(x, y, elevOf(n.layer));
                const isSel = selected === n.id;
                const fact = nodeFact(n);
                const dim = focus !== null && !focus.nodes.has(n.id);
                const hov = hover?.kind === "node" && hover.id === n.id;
                return (
                  <div key={`title-${n.id}`} className="adg-anchor" style={{ left: px, top: py, transform: "none" }} aria-hidden="true">
                    <div
                      className={`adg-ghost${n.peripheral ? " periph" : ""}${isSel ? " sel" : ""}${traceNode === n.id ? " lit" : ""}${dim ? " dim" : ""}${hov ? " hov" : ""}`}
                      style={{ ["--ty" as string]: `${-(8 + (isSel ? 8 : 0))}px` } as CSSProperties}
                    >
                      {labelEl(n, fact, fact?.level ?? "info")}
                      {frameEl(n, false)}
                    </div>
                  </div>
                );
              })}

            {floors && (
              <svg className="adg-svg adg-heads" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
                {links.flatMap((x, i) => {
                  if (!x || x.r.pattern === "dependency") return [];
                  const { hot, dim, quiet, level, hid } = stateOf(x, i);
                  const cls = `adg-head${x.r.interaction === "async" ? " async" : ""}${level ? ` lv-${level}` : ""}${hot ? " hot" : ""}${dim ? " dim" : ""}${quiet ? " quiet" : ""}${hid ? " hid" : ""}`;
                  const e = elevOf(byId.get(x.l.from)?.layer);
                  /** A triangle with its tip at `tip`, pointing along `dir` (screen space). */
                  const head = (key: string, tip: [number, number], dir: [number, number]) => {
                    const n = Math.hypot(dir[0], dir[1]) || 1;
                    const [ux, uy] = [dir[0] / n, dir[1] / n];
                    const [bx, by] = [tip[0] - ux * 15, tip[1] - uy * 15];
                    return <path key={`${key}-${i}`} className={cls} d={`M${tip[0]} ${tip[1]} L${bx - uy * 7} ${by + ux * 7} L${bx + uy * 7} ${by - ux * 7} z`} />;
                  };
                  const pts = x.g.pts;
                  const c = crossLinks.find((k) => k.i === i);
                  const out = [];
                  // an arrow dropping into a card from the floor above ends on its name plate: no head there, it only sat on the name
                  if (c) { if (!c.down) out.push(head("end", c.tip, [0, -1])); }
                  else {
                    const last = pts[pts.length - 1]!;
                    const before = pts[pts.length - 2]!;
                    const tip = proj(last[0], last[1], e);
                    const prev = proj(before[0], before[1], e);
                    out.push(head("end", tip, [tip[0] - prev[0], tip[1] - prev[1]]));
                  }
                  if (x.r.twoWay) {
                    const first = pts[0]!;
                    const second = pts[1]!;
                    const t0 = proj(first[0], first[1], e);
                    const t1 = proj(second[0], second[1], e);
                    out.push(head("start", t0, [t0[0] - t1[0], t0[1] - t1[1]]));
                  }
                  return out;
                })}
              </svg>
            )}

            {/* Chips come after the cards so they are never covered. */}
            {links.map((x, i) => {
              if (!x) return null;
              const { l, r, g } = x;
              const hot = hover?.kind === "edge" && hover.i === i;
              // An off-path link's label waits until the link is pointed at, selected, traced, or next to the component in focus.
              const inFocus = (focus?.lit.has(i) ?? false) || selLinks.has(i) || pathLinks.has(i);
              const hid = hiddenOf(x, i);
              const show = ((mode === "top" && !portrait && (!r.offPath || inFocus)) && !hid) || hot || selEdge === i || routeSet.has(i);
              const dim = focus !== null ? !focus.lit.has(i) : selEdge !== null && selEdge !== i && !routeSet.has(i) && !pathLinks.has(i);
              const fact = linkFact(l);
              const text = fact ? fact.badge : l.label;
              const mid: [number, number] = floors ? proj(g.mid[0], g.mid[1], elevOf(byId.get(l.from)?.layer)) : g.mid; // on the floor the arrow runs along
              return (
                <div key={`chip-${l.from}-${l.to}-${i}`} className="adg-anchor chipa" style={{ left: mid[0], top: mid[1], transform: floors ? "none" : counter }}>
                  <button
                    type="button"
                    className={`adg-chip${fact ? ` lens lv-${fact.level ?? "info"}` : ""}${show ? " show" : ""}${hot || selEdge === i ? " hot" : ""}${dim ? " dim" : ""}`}
                    style={{ ["--ty" as string]: mode === "iso" ? "-6px" : "11px" } as CSSProperties}
                    aria-label={`${text}. Connection from ${byId.get(l.from)?.label} to ${byId.get(l.to)?.label}${l.traffic && l.traffic !== "internal" ? `, ${l.traffic}` : ""}`}
                    onPointerEnter={() => setHover({ kind: "edge", i })}
                    onPointerLeave={() => setHover(null)}
                    onFocus={(ev) => {
                      setHover({ kind: "edge", i });
                      revealFocused(ev.currentTarget);
                    }}
                    onBlur={() => setHover(null)}
                    onClick={() => chooseEdge(i)}
                  >
                    <span className="adg-chip-in">
                      {(l.traffic === "ingress" || l.traffic === "egress") && (
                        <span className="adg-tr" aria-hidden="true" data-tag={l.traffic === "egress" ? "out" : "in"} />
                      )}
                      {fact?.level && <span aria-hidden="true">{LEVEL_GLYPH[fact.level]}&nbsp;</span>}
                      {text}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {traceBar && <TraceBar {...traceBar} />}

      {attribution && <p className="adg-attrib">{attribution}</p>}

      {(used.async || used.twoWay || used.off || used.dep || used.scale || used.ingress || used.egress || used.periph) && (
        <div className="adg-legend" aria-label="Legend">
          <span>
            <i className="adg-key" /> Sync
          </span>
          {used.async && (
            <span>
              <i className="adg-key async" /> Async
            </span>
          )}
          {used.twoWay && <span>↔ Response returns on the same path</span>}
          {used.off && (
            <span>
              <i className="adg-key off" /> Off the request path (faded until you point at it)
            </span>
          )}
          {used.dep && (
            <span>
              <i className="adg-key dep" /> Dependency (no data flow)
            </span>
          )}
          {used.scale && <span>×n–m Scaled fleet</span>}
          {used.periph && (
            <span>
              <i className="adg-key box" /> Peripheral tooling
            </span>
          )}
          {used.ingress && (
            <span>
              <b className="adg-tr">in</b> Ingress
            </span>
          )}
          {used.egress && (
            <span>
              <b className="adg-tr">out</b> Egress
            </span>
          )}
        </div>
      )}

      <div className="adg-info" aria-live="polite">
        {edgeInfo ? (
          <>
            <div className="adg-info-head">
              <span className="adg-info-tag">
                Connection · {edgeInfo.r.pattern.replace("-", " ")}
                {edgeInfo.r.interaction ? ` · ${edgeInfo.r.interaction}` : ""}
                {edgeInfo.r.protocol ? ` · ${edgeInfo.r.protocol}` : ""}
                {edgeInfo.l.traffic && edgeInfo.l.traffic !== "internal" ? ` · ${edgeInfo.l.traffic}` : ""}
                {edgeInfo.r.offPath ? " · off the request path" : ""}
              </span>
              <h3>
                {byId.get(edgeInfo.l.from)?.label} {edgeInfo.r.twoWay ? "↔" : "→"} {byId.get(edgeInfo.l.to)?.label}
              </h3>
            </div>
            <div>
              <p>
                <b>{edgeInfo.l.label}</b>
                {edgeInfo.l.detail}
              </p>
              {edgeInfo.r.twoWay && <p>The response returns on the same path.</p>}
              {lens !== FLOW && linkFact(edgeInfo.l) && <LensLine label={lensDef.label} fact={linkFact(edgeInfo.l)!} />}
            </div>
          </>
        ) : infoZone && zoneInside ? (
          <>
            <div className="adg-info-head">
              <span className="adg-info-tag">Container · {infoZone.kind}</span>
              <h3>{infoZone.label}</h3>
            </div>
            <div>
              <p>
                {zoneInside.size} component{zoneInside.size === 1 ? "" : "s"} inside.{" "}
                {zoneCrossing.length
                  ? `${zoneCrossing.length} arrow${zoneCrossing.length === 1 ? "" : "s"} cross its edge, and the components they connect to are lit too.`
                  : "No arrow crosses its edge."}
              </p>
              {zoneCrossing.length > 0 && (
                <p>
                  {zoneCrossing.map((l) => `${zoneInside.has(l.to) ? "In" : "Out"}: ${l.label} (${byId.get(zoneInside.has(l.to) ? l.from : l.to)?.label})`).join(" · ")}
                </p>
              )}
            </div>
          </>
        ) : nodeInfo ? (
          <>
            <div className="adg-info-head">
              <span className="adg-info-tag">{nodeInfo.detail?.tag ?? nodeInfo.sub ?? "Component"}
                {nodeInfo.peripheral ? " · peripheral" : ""}</span>
              <h3>{nodeInfo.label}</h3>
            </div>
            <div>
              {nodeInfo.detail?.role && <p>{nodeInfo.detail.role}</p>}
              {nodeInfo.id.startsWith(collapsedId("")) && (
                <p>
                  <button type="button" className="adg-btn adg-tool" onClick={() => foldZone(nodeInfo.id.slice(collapsedId("").length), false)}>
                    Expand {nodeInfo.label}
                  </button>
                </p>
              )}
              {lens === FLOW ? (
                <>
                  {nodeInfo.detail?.why && (
                    <p>
                      <b>Why</b>
                      {nodeInfo.detail.why}
                    </p>
                  )}
                  {nodeInfo.detail?.tradeoff && (
                    <p>
                      <b>Trade-off</b>
                      {nodeInfo.detail.tradeoff}
                    </p>
                  )}
                </>
              ) : nodeFact(nodeInfo) ? (
                <LensLine label={lensDef.label} fact={nodeFact(nodeInfo)!} />
              ) : (
                <p>
                  <b>{lensDef.label}</b>No {lensDef.label.toLowerCase()} note for this component.
                </p>
              )}
              {nodeInfo.scale && (
                <p>
                  <b>Scale</b>
                  {scaleText(nodeInfo.scale)}
                  {nodeInfo.scale.unit ? ` ${nodeInfo.scale.unit}` : ""}
                  {nodeInfo.scale.trigger ? ` · ${nodeInfo.scale.trigger}` : ""}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="adg-info-head">
              <span className="adg-info-tag">{lens === FLOW ? "Overview" : `${lensDef.label} lens`}</span>
              <h3>{spec.title}</h3>
            </div>
            <div>
              <p>{lensDef.summary || "Hover or select a component or an arrow to see what it does."}</p>
            </div>
          </>
        )}
      </div>

      {/* What each card sends and receives, read out after its name. Hidden from sight, still available to assistive technology. */}
      <div hidden>
        {spec.nodes.map((n) => (
          <span key={n.id} id={`${uid}-d-${n.id}`}>
            {describeConnections(spec, n.id)}
          </span>
        ))}
      </div>

      <TextView spec={spec} lenses={lenses} />
    </div>
  );
}

function LensLine({ label, fact }: { label: string; fact: { badge: string; text?: string; level?: Level } }) {
  const level = fact.level ?? "info";
  return (
    <p className={`lv-${level}`}>
      <b>{label}</b>
      <span className="lvtxt">
        {LEVEL_GLYPH[level]} {LEVEL_WORD[level]}
      </span>
      {fact.text ?? fact.badge}
    </p>
  );
}
