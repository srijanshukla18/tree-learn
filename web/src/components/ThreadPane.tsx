import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ArrowUpLeft, Bookmark, Check, ChevronRight, Clock, Copy, CornerDownRight, GitBranch, Lightbulb, Loader2, MessageSquareQuote, PanelRightClose, Play,
  RefreshCw, Sparkles, AlertTriangle,
} from "lucide-react";
import { childrenOf } from "@shared/tree";
import type { TreeNode } from "@shared/types";
import { useWorkspace } from "../state/workspace";
import { Composer, type ComposerHandle } from "./Composer";
import { Exchange } from "./Exchange";
import { ModelPicker } from "./ModelPicker";

function StateIcon({ n }: { n: TreeNode }) {
  if (n.status === "streaming") return <Loader2 size={13} className="spin" />;
  if (n.status === "parked") return <Clock size={13} />;
  if (n.status === "error") return <AlertTriangle size={13} />;
  if (n.unread) return <span style={{ width: 8, height: 8, borderRadius: 8, background: "var(--accent)" }} />;
  return <CornerDownRight size={13} />;
}

function BranchRow({ n, sub }: { n: TreeNode; sub?: string }) {
  const ws = useWorkspace();
  return (
    <button className={"branch" + (n.unread ? " unread" : "") + (n.status === "parked" ? " parked" : "")} onClick={() => ws.select(n.id)}>
      <span className="state"><StateIcon n={n} /></span>
      <span className="q">{n.question}</span>
      {sub && <span className="sub">{sub}</span>}
      {n.status === "parked" && (
        <span
          role="button"
          className="btn sm"
          onClick={(e) => {
            e.stopPropagation();
            ws.select(n.id);
            ws.runNode(n.id);
          }}
        >
          <Play size={11} fill="currentColor" /> Ask
        </span>
      )}
    </button>
  );
}

/** Below the current answer: the branches that exist, and the ones worth opening. */
function WhereNext({ node }: { node: TreeNode }) {
  const ws = useWorkspace();
  const kids = ws.childrenOf(node.id);
  const busy = ws.suggesting.has(node.id);
  const ideas = node.suggestions ?? [];
  if (node.status !== "done") return null;
  return (
    <div className="next">
      {kids.length > 0 && (
        <>
          <div className="next-label"><GitBranch size={12} /> Branches from here</div>
          {kids.map((k) => <BranchRow key={k.id} n={k} sub={ws.childrenOf(k.id).length ? `${ws.childrenOf(k.id).length} below` : undefined} />)}
        </>
      )}
      <div className="next-label">
        <Sparkles size={12} /> Rabbit holes
        {ideas.length > 0 && (
          <button className="btn sm ghost" disabled={busy} onClick={() => void ws.suggest(node.id)}>
            {busy ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />} New ideas
          </button>
        )}
      </div>
      {ideas.length > 0 ? (
        <div className="chips">
          {ideas.map((s, i) => (
            <div className="chip" key={s} style={{ animationDelay: `${i * 35}ms` }}>
              <button className="chip-main" onClick={(e) => void ws.takeSuggestion(node.id, s, e.metaKey || e.ctrlKey ? "stay" : "ask")}>
                <CornerDownRight size={14} /> {s}
              </button>
              <button className="chip-side" data-tip="Park for later" aria-label="Park for later" data-tip-pos="left" onClick={() => void ws.takeSuggestion(node.id, s, "park")}><Clock size={14} /></button>
            </div>
          ))}
        </div>
      ) : (
        <button className="suggest-btn" disabled={busy} onClick={() => void ws.suggest(node.id)}>
          {busy ? <Loader2 size={15} className="spin" /> : <Lightbulb size={15} />}
          {busy ? "Looking for good questions…" : "Suggest questions worth branching into"}
        </button>
      )}
    </div>
  );
}

/** With nothing selected the pane shows the state of the whole topic: what is open, unread, saved. */
function Overview() {
  const ws = useWorkspace();
  const nodes = useMemo(() => (ws.tree ? Object.values(ws.tree.nodes).sort((a, b) => a.createdAt - b.createdAt) : []), [ws.tree]);
  const groups: [string, React.ReactNode, TreeNode[]][] = [
    ["Parked questions", <Clock size={12} key="p" />, nodes.filter((n) => n.status === "parked")],
    ["Unread answers", <Check size={12} key="u" />, nodes.filter((n) => n.unread)],
    ["Bookmarked", <Bookmark size={12} key="b" />, nodes.filter((n) => n.bookmarked)],
    ["Starting points", <GitBranch size={12} key="r" />, ws.tree ? childrenOf(ws.tree, null) : []],
  ];
  return (
    <div className="overview">
      <h2>{ws.tree?.title}</h2>
      <div className="stats">
        {ws.counts.total} {ws.counts.total === 1 ? "node" : "nodes"}
        {ws.counts.parked ? ` · ${ws.counts.parked} parked` : ""}
        {ws.counts.unread ? ` · ${ws.counts.unread} unread` : ""}
      </div>
      {groups.filter(([, , list]) => list.length).map(([label, icon, list]) => (
        <div key={label}>
          <div className="next-label">
            {icon} {label}
            {label === "Unread answers" && <button className="btn sm ghost" onClick={ws.markAllRead}>Mark all read</button>}
          </div>
          {list.map((n) => <BranchRow key={n.id} n={n} />)}
        </div>
      ))}
      <p className="overview-empty">Pick any node on the tree to read it, or ask below to start another line of questions in this topic.</p>
    </div>
  );
}

interface Pop {
  x: number;
  y: number;
  nodeId: string;
  text: string;
}

export function ThreadPane({ composer, onCollapse, resizer }: { composer: RefObject<ComposerHandle | null>; onCollapse: () => void; resizer?: React.ReactNode }) {
  const ws = useWorkspace();
  const { tree, path, selected, selectedId } = ws;
  const thread = useRef<HTMLDivElement>(null);
  const crumbs = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  /** Where the learner was inside each answer, so coming back to a node resumes the read. */
  const offsets = useRef(new Map<string, number>());
  const stick = useRef(false);

  const currentEl = useCallback(() => (selectedId ? thread.current?.querySelector<HTMLElement>(`[data-ex="${selectedId}"]`) : null), [selectedId]);

  // Land on the selected exchange, at the remembered reading position.
  useLayoutEffect(() => {
    const box = thread.current;
    const el = currentEl();
    if (!box) return;
    if (!el) return void (box.scrollTop = 0);
    const top = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTop = top + (offsets.current.get(selectedId!) ?? 0);
    stick.current = false;
    crumbs.current?.scrollTo({ left: crumbs.current.scrollWidth });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, tree?.id]);

  useEffect(() => {
    const box = thread.current;
    if (!box) return;
    // Only the learner's own scrolling can opt in to following a streaming answer. Our programmatic scrolls
    // (and the fact that a brand-new answer is shorter than the screen) must not count as "reading at the end".
    let userScrolledAt = 0;
    const byUser = () => (userScrolledAt = Date.now());
    const onScroll = () => {
      const el = currentEl();
      if (!el || !selectedId) return;
      const view = box.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      offsets.current.set(selectedId, Math.max(0, view.top - rect.top));
      if (Date.now() - userScrolledAt < 400) stick.current = rect.height > view.height && Math.abs(rect.bottom - view.bottom) < 90;
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    for (const type of ["wheel", "touchmove", "keydown", "pointerdown"] as const) box.addEventListener(type, byUser, { passive: true });
    return () => {
      box.removeEventListener("scroll", onScroll);
      for (const type of ["wheel", "touchmove", "keydown", "pointerdown"] as const) box.removeEventListener(type, byUser);
    };
  }, [currentEl, selectedId]);

  // While an answer streams, follow it only if the learner is already reading at its end.
  useEffect(() => {
    const box = thread.current;
    const el = currentEl();
    if (!box || !el || selected?.status !== "streaming" || !stick.current) return;
    const over = el.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom;
    if (over > -24) box.scrollTop += over + 24;
  }, [selected?.answer, selected?.thinking, selected?.status, currentEl]);

  // Selecting text inside an answer offers to branch from it.
  useEffect(() => {
    const onUp = () =>
      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        if (!sel || sel.rangeCount === 0 || text.length < 2) return setPop(null);
        const range = sel.getRangeAt(0);
        const within = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        const ex = within?.closest<HTMLElement>(".ex");
        if (!ex || !within?.closest(".ex-body") || !thread.current?.contains(ex)) return setPop(null);
        const r = range.getBoundingClientRect();
        setPop({ x: Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150), y: Math.max(r.top - 8, 48), nodeId: ex.dataset.ex!, text });
      }, 0);
    const onDown = (e: MouseEvent) => !(e.target as HTMLElement).closest(".sel-pop") && setPop(null);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setPop(null);
  };

  const reask = (node: TreeNode) => {
    ws.select(node.parentId);
    if (node.quote && node.parentId) ws.setQuote({ nodeId: node.parentId, text: node.quote });
    setTimeout(() => composer.current?.fill(node.question), 30);
  };

  const canBranch = !selected || selected.status === "done" || selected.status === "error";

  return (
    <aside className="pane">
      {resizer}
      <div className="pane-head">
        <button className="icon-btn sm" disabled={!selected} onClick={() => ws.select(selected?.parentId ?? null)} data-tip={selected?.parentId ? "Up to parent" : "Topic overview"} aria-label={selected?.parentId ? "Up to parent" : "Topic overview"} data-tip-pos="right">
          <ArrowUpLeft size={15} />
        </button>
        <div className="crumbs" ref={crumbs}>
          <button className={"crumb" + (path.length ? "" : " cur")} onClick={() => ws.select(null)}>{tree?.title}</button>
          {path.map((n, i) => (
            <span key={n.id} style={{ display: "contents" }}>
              <ChevronRight size={12} />
              <button className={"crumb" + (i === path.length - 1 ? " cur" : "")} onClick={() => ws.select(n.id)}>{n.question}</button>
            </span>
          ))}
        </div>
        <button className="icon-btn sm only-wide" onClick={onCollapse} data-tip="Hide reading pane  ]" aria-label="Hide reading pane" data-tip-pos="left"><PanelRightClose size={15} /></button>
        <button className="btn sm only-narrow" onClick={onCollapse}><GitBranch size={13} /> Tree</button>
      </div>

      <div className="thread" ref={thread}>
        <div className="thread-col">
          {!selected && tree && <Overview />}
          {path.map((n) => (
            <Exchange
              key={n.id}
              node={n}
              current={n.id === selectedId}
              siblings={ws.childrenOf(n.parentId)}
              quotes={ws.childrenOf(n.id).flatMap((c) => (c.quote ? [{ id: c.id, text: c.quote }] : []))}
              onReask={reask}
            />
          ))}
          {selected && <WhereNext node={selected} />}
          {/* Room to scroll even a one-line exchange up to the top of the pane. */}
          {selected && <div className="thread-tail" />}
        </div>
      </div>

      {pop && (
        <div className="sel-pop" style={{ left: pop.x, top: pop.y }}>
          <button
            onClick={() => {
              ws.select(pop.nodeId);
              ws.setQuote({ nodeId: pop.nodeId, text: pop.text });
              clearSelection();
              setTimeout(() => composer.current?.focus(), 40);
            }}
          >
            <MessageSquareQuote size={14} /> Ask about this
          </button>
          <button
            onClick={() => {
              const short = pop.text.length <= 60 && !pop.text.includes("\n");
              void ws.ask(short ? `Explain “${pop.text}”` : "Explain this passage", { parentId: pop.nodeId, quote: pop.text });
              clearSelection();
            }}
          >
            <Lightbulb size={14} /> Explain
          </button>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(pop.text);
              clearSelection();
            }}
          >
            <Copy size={13} /> Copy
          </button>
        </div>
      )}

      <div className="dock">
        <div className="dock-col">
          <div className="target">
            {selected ? <CornerDownRight size={13} /> : <GitBranch size={13} />}
            {!selected ? <span>New line of questions in this topic</span> : selected.status === "parked" ? <span>This question is parked</span> : <><span>Follow-up to</span><b>{selected.question}</b></>}
          </div>
          {selected?.status === "parked" ? (
            <div className="composer">
              <div className="composer-row" style={{ padding: 4 }}>
                <ModelPicker />
                <span className="spacer" />
                <button className="btn primary sm" onClick={() => ws.runNode(selected.id)}><Play size={12} fill="currentColor" /> Ask now</button>
              </div>
            </div>
          ) : (
            <Composer
              ref={composer}
              hints
              placeholder={!selected ? "Ask something new" : canBranch ? "Ask a follow-up" : "You can park questions while this answers"}
              quote={ws.quote?.text}
              onClearQuote={() => ws.setQuote(null)}
              onAsk={(text, stay) => (canBranch ? ws.ask(text, { quote: ws.quote?.text, stay }) : false)}
              onPark={(text) => ws.park(text, { quote: ws.quote?.text })}
              streaming={selected?.status === "streaming"}
              onStop={() => selected && ws.abort(selected.id)}
              left={<ModelPicker />}
            />
          )}
        </div>
      </div>
    </aside>
  );
}
