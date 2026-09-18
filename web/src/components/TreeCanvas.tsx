import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Clock, GitBranch, Maximize, Minus, Play, Plus, Quote, Sparkles, StickyNote } from "lucide-react";
import type { TreeNode } from "@shared/types";
import { useWorkspace } from "../state/workspace";
import { computeLayout, linkPath, NODE_H, NODE_W, shapeKey, type Placed } from "../lib/layout";
import { plain } from "../lib/misc";
import { usePref } from "../lib/prefs";

interface View {
  x: number;
  y: number;
  k: number;
}
const MIN_K = 0.18;
const MAX_K = 2;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

export function TreeCanvas({ onBranch }: { onBranch: (nodeId: string) => void }) {
  const ws = useWorkspace();
  const tree = ws.tree!;
  const { selectedId, selected, pathIds } = ws;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 60, y: 120, k: 1 });
  const [glide, setGlide] = useState(false);
  const [panning, setPanning] = useState(false);
  const [showIdeas, setShowIdeas] = usePref("show-ideas", true);
  const viewRef = useRef(view);
  viewRef.current = view;

  const ghosts = useMemo(
    () => (showIdeas && selected?.status === "done" && selected.suggestions?.length ? { parentId: selected.id, suggestions: selected.suggestions } : undefined),
    [showIdeas, selected?.id, selected?.status, selected?.suggestions],
  );
  const key = shapeKey(tree, ghosts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => computeLayout(tree, ghosts), [key]);

  // ---------- which nodes are new since the last picture (they grow out of their parent) ----------
  const known = useRef<{ treeId: string; ids: Set<string> }>({ treeId: "", ids: new Set() });
  const fresh = useMemo(
    () => (known.current.treeId === tree.id ? new Set(layout.nodes.filter((n) => !known.current.ids.has(n.id)).map((n) => n.id)) : new Set<string>()),
    [layout, tree.id],
  );
  useEffect(() => {
    known.current = { treeId: tree.id, ids: new Set(layout.nodes.map((n) => n.id)) };
  }, [layout, tree.id]);

  // ---------- camera ----------
  const glideTo = useCallback((next: View) => {
    setGlide(true);
    setView(next);
    window.setTimeout(() => setGlide(false), 520);
  }, []);

  const lastFit = useRef(0);
  /** True once the learner has panned or zoomed by hand; until then the camera is ours to manage. */
  const userMoved = useRef(false);
  const fit = useCallback(
    (smart = false) => {
      userMoved.current = false;
      const box = wrap.current?.getBoundingClientRect();
      if (!box || !layout.nodes.length) return;
      const { minX, minY, maxX, maxY } = layout.bounds;
      const w = maxX - minX;
      const h = maxY - minY;
      let k = Math.min(1, (box.width - 96) / w, (box.height - 170) / h);
      lastFit.current = Date.now();
      const focus = selectedId ? layout.byId.get(selectedId) : undefined;
      if (smart && k < 0.55 && focus) {
        // Too big to read when fully fitted: open on the node the learner was at instead.
        k = 0.85;
        return glideTo({ k, x: box.width / 2 - (focus.x + NODE_W / 2) * k, y: box.height / 2 - (focus.y + NODE_H / 2) * k });
      }
      k = clampK(k);
      glideTo({ k, x: (box.width - w * k) / 2 - minX * k, y: (box.height - h * k) / 2 - minY * k + 18 });
    },
    [layout, selectedId, glideTo],
  );

  const zoomAt = useCallback((cx: number, cy: number, factor: number, smooth = false) => {
    const v = viewRef.current;
    const k = clampK(v.k * factor);
    const next = { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) };
    if (smooth) glideTo(next);
    else setView(next);
  }, [glideTo]);

  const zoomCenter = (factor: number) => {
    userMoved.current = true;
    const box = wrap.current!.getBoundingClientRect();
    zoomAt(box.width / 2, box.height / 2, factor, true);
  };

  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener("tree-learn:fit", onFit);
    return () => window.removeEventListener("tree-learn:fit", onFit);
  }, [fit]);

  // Open each topic fitted to the window.
  const fittedFor = useRef("");
  useLayoutEffect(() => {
    if (fittedFor.current === tree.id || !layout.nodes.length) return;
    fittedFor.current = tree.id;
    fit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.id, layout.nodes.length > 0]);

  // Keep the selected node on screen, moving the camera as little as possible.
  const reveal = useCallback(() => {
    const box = wrap.current?.getBoundingClientRect();
    const p = selectedId ? layout.byId.get(selectedId) : undefined;
    if (!box || !p) return;
    const hasIdeas = ghosts?.parentId === selectedId;
    setView((v) => {
      const left = p.x * v.k + v.x;
      const top = p.y * v.k + v.y;
      const right = left + (NODE_W + (hasIdeas ? NODE_W + 110 : 0)) * v.k;
      const bottom = top + NODE_H * v.k;
      const pad = 36;
      let dx = 0;
      let dy = 0;
      if (left < pad) dx = pad - left;
      else if (right > box.width - pad) dx = Math.max(box.width - pad - right, pad - left);
      if (top < pad + 56) dy = pad + 56 - top;
      else if (bottom > box.height - pad - 40) dy = box.height - pad - 40 - bottom;
      if (!dx && !dy) return v;
      setGlide(true);
      window.setTimeout(() => setGlide(false), 520);
      return { ...v, x: v.x + dx, y: v.y + dy };
    });
  }, [selectedId, layout, ghosts?.parentId]);

  useEffect(() => {
    if (Date.now() - lastFit.current >= 700) reveal();
  }, [reveal]);

  // The canvas changes size when the reading pane opens, closes or is dragged, and when the window resizes.
  // If the learner has not touched the camera, frame the tree again; otherwise just keep their node in sight.
  const onResize = useRef(() => {});
  onResize.current = () => (userMoved.current ? reveal() : fit(true));
  useEffect(() => {
    let timer = 0;
    let width = wrap.current?.clientWidth ?? 0;
    const observer = new ResizeObserver(([entry]) => {
      if (Math.abs(entry.contentRect.width - width) < 8) return;
      width = entry.contentRect.width;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => onResize.current(), 320); // after the pane's slide has finished
    });
    observer.observe(wrap.current!);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  // ---------- wheel, trackpad pinch, Safari gestures ----------
  useEffect(() => {
    const el = canvas.current!;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      userMoved.current = true;
      if (e.ctrlKey || e.metaKey) zoomAt(...local(e), Math.exp(-e.deltaY * unit * 0.0032));
      else setView((v) => ({ ...v, x: v.x - e.deltaX * unit, y: v.y - e.deltaY * unit }));
    };
    let startK = 1;
    const onGestureStart = (e: Event) => (e.preventDefault(), (startK = viewRef.current.k));
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      userMoved.current = true;
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      zoomAt(...local(g), (startK * g.scale) / viewRef.current.k);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, [zoomAt]);

  // ---------- drag to pan, two fingers to pinch ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const pinch = useRef<{ dist: number; k: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      drag.current = null;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = canvas.current!.getBoundingClientRect();
      const want = pinch.current.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist);
      userMoved.current = true;
      return zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, want / viewRef.current.k);
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 4) {
      d.moved = true;
      userMoved.current = true;
      setPanning(true);
      canvas.current?.setPointerCapture(e.pointerId); // from here on, releasing over a card will not click it
    }
    if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      drag.current = null;
      setPanning(false);
    }
  };

  const step = 22 * view.k * (view.k < 0.5 ? 2 : 1);

  return (
    <div className={"canvas-wrap" + (view.k < 0.62 ? " zoom-far" : "")} ref={wrap} style={{ ["--node-w" as string]: `${NODE_W}px`, ["--node-h" as string]: `${NODE_H}px` }}>
      <div className="canvas-dots" style={{ backgroundSize: `${step}px ${step}px`, backgroundPosition: `${view.x}px ${view.y}px` }} />
      <div className="canvas-vignette" />
      <div
        ref={canvas}
        className={"canvas" + (panning ? " panning" : "")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => !(e.target as HTMLElement).closest(".node") && fit()}
      >
        <div className={"world" + (glide ? " glide" : "")} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="edges" width="1" height="1">
            {layout.links.map((l) => {
              const n = tree.nodes[l.to.id]; // live node: the memoized layout only knows the tree's shape
              const cls = l.to.ghost ? " ghost" : n?.status === "parked" ? " parked" : n?.status === "streaming" ? " streaming" : pathIds.has(l.to.id) && pathIds.has(l.from.id) ? " on-path" : "";
              return <path key={l.id} className={"edge" + cls + (fresh.has(l.to.id) ? " enter" : "")} d={linkPath(l)} />;
            })}
          </svg>
          {layout.nodes.map((p) => {
            const from = fresh.has(p.id) && p.parentId ? layout.byId.get(p.parentId) : undefined;
            return p.ghost ? (
              <GhostCard key={p.id} p={p} from={from} onAsk={(stay) => void ws.takeSuggestion(p.ghost!.parentId, p.ghost!.text, stay ? "stay" : "ask")} onPark={() => void ws.takeSuggestion(p.ghost!.parentId, p.ghost!.text, "park")} />
            ) : (
              <NodeCard
                key={p.id}
                p={p}
                n={tree.nodes[p.id] ?? p.node!}
                from={from}
                selected={p.id === selectedId}
                onPath={pathIds.has(p.id)}
                onSelect={ws.select}
                onBranch={onBranch}
                onRun={ws.runNode}
                onFold={(id, folded) => ws.patchNode(id, { collapsed: folded })}
              />
            );
          })}
        </div>
      </div>

      <div className="float zoom">
        <button className={"icon-btn" + (showIdeas ? " on" : "")} onClick={() => setShowIdeas((v) => !v)} data-tip={showIdeas ? "Hide suggested branches" : "Show suggested branches"} aria-label="Toggle suggested branches" aria-pressed={showIdeas}><Sparkles size={15} /></button>
        <span className="sep" />
        <button className="icon-btn" onClick={() => zoomCenter(1 / 1.3)} data-tip="Zoom out" aria-label="Zoom out"><Minus size={15} /></button>
        <button className="pct" onClick={() => zoomCenter(1 / view.k)} data-tip="Actual size" aria-label="Actual size">{Math.round(view.k * 100)}%</button>
        <button className="icon-btn" onClick={() => zoomCenter(1.3)} data-tip="Zoom in" aria-label="Zoom in"><Plus size={15} /></button>
        <button className="icon-btn" onClick={() => fit()} data-tip="Fit the whole tree  F" data-tip-pos="left" aria-label="Fit"><Maximize size={14} /></button>
      </div>
    </div>
  );
}

/** New cards grow out of their parent instead of popping into place. */
function useGrowFrom(ref: React.RefObject<HTMLDivElement | null>, p: Placed, from?: Placed) {
  useLayoutEffect(() => {
    if (!from || !ref.current?.animate) return;
    ref.current.animate(
      [
        { transform: `translate(${from.x}px, ${from.y}px) scale(0.86)`, opacity: 0 },
        { transform: `translate(${p.x}px, ${p.y}px) scale(1)`, opacity: 1 },
      ],
      { duration: 460, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

interface CardProps {
  p: Placed;
  n: TreeNode;
  from?: Placed;
  selected: boolean;
  onPath: boolean;
  onSelect: (id: string) => void;
  onBranch: (id: string) => void;
  onRun: (id: string) => void;
  onFold: (id: string, folded: boolean) => void;
}

const NodeCard = memo(function NodeCard({ p, n, from, selected, onPath, onSelect, onBranch, onRun, onFold }: CardProps) {
  const ref = useRef<HTMLDivElement>(null);
  useGrowFrom(ref, p, from);
  const streaming = n.status === "streaming";
  const parked = n.status === "parked";
  const cls = ["node", selected && "selected", onPath && "on-path", streaming && "streaming", parked && "parked", n.status === "error" && "error"].filter(Boolean).join(" ");
  return (
    <div
      ref={ref}
      className={cls}
      style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
      onClick={() => onSelect(n.id)}
      onDoubleClick={(e) => (e.stopPropagation(), !parked && onBranch(n.id))}
    >
      {n.quote && <span className="node-quote"><Quote size={7} fill="currentColor" /></span>}
      {n.unread && <span className="node-unread" />}
      <div className="node-q">{n.question}</div>
      {parked ? (
        <div className="node-tag">
          <Clock size={11} /> <span>Parked</span>
          <button className="node-play" onClick={(e) => (e.stopPropagation(), onSelect(n.id), onRun(n.id))}><Play size={9} fill="currentColor" /> Ask</button>
        </div>
      ) : (
        <div className="node-a">
          {streaming && !n.answer ? <><span className="dots"><i /><i /><i /></span>&nbsp; {n.thinking ? "thinking" : "asking"}</> : n.status === "error" ? (n.error ?? "Failed") : plain(n.answer, 200)}
        </div>
      )}
      <div className="node-badges">
        {n.bookmarked && <Bookmark size={11} className="bm" fill="currentColor" />}
        {n.note && <StickyNote size={11} />}
        {p.kids > 0 && (
          <button className={"kids" + (n.collapsed ? " folded" : "")} onClick={(e) => (e.stopPropagation(), onFold(n.id, !n.collapsed))} aria-label={n.collapsed ? "Unfold branches" : "Fold branches"}>
            <GitBranch size={10} /> {n.collapsed ? `+${p.hidden}` : p.kids}
          </button>
        )}
      </div>
      {streaming && <span className="node-stream" />}
      {!parked && !streaming && (
        <button className="node-add" onClick={(e) => (e.stopPropagation(), onBranch(n.id))} aria-label="Branch from here"><Plus size={14} /></button>
      )}
    </div>
  );
});

function GhostCard({ p, from, onAsk, onPark }: { p: Placed; from?: Placed; onAsk: (stay: boolean) => void; onPark: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useGrowFrom(ref, p, from);
  return (
    <div ref={ref} className="node ghost" style={{ transform: `translate(${p.x}px, ${p.y}px)` }} onClick={(e) => onAsk(e.metaKey || e.ctrlKey)}>
      <div className="node-q">{p.ghost!.text}</div>
      <div className="node-tag">
        <Sparkles size={11} /> <span>Suggested · click to ask</span>
        <button className="icon-btn sm ghost-park" onClick={(e) => (e.stopPropagation(), onPark())} aria-label="Park for later"><Clock size={13} /></button>
      </div>
    </div>
  );
}
