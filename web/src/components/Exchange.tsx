import { lazy, memo, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle, Bookmark, Brain, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Copy, Check, Loader2, Pencil, Play, RefreshCw,
  Square, StickyNote, Trash2,
} from "lucide-react";
import type { TreeNode } from "@shared/types";
import { useWorkspace } from "../state/workspace";
import { findRange, rangeContainsPoint, setQuoteRanges } from "../lib/highlights";
import { formatCost, formatDuration, plain, shortModel } from "../lib/misc";

// Markdown, math and syntax highlighting are most of the bundle; the landing screen never needs them.
const LazyMarkdown = lazy(() => import("./Markdown"));
function Markdown(props: { text: string; streaming?: boolean }) {
  return (
    <Suspense fallback={<div className="md" style={{ whiteSpace: "pre-wrap" }}>{props.text}</div>}>
      <LazyMarkdown {...props} />
    </Suspense>
  );
}

interface Props {
  node: TreeNode;
  current: boolean;
  siblings: TreeNode[];
  /** Children that were branched from a passage of this answer. */
  quotes: { id: string; text: string }[];
  onReask: (node: TreeNode) => void;
}

export const Exchange = memo(function Exchange({ node, current, siblings, quotes, onReask }: Props) {
  const ws = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.question);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(node.note ?? "");
  const [thoughtsOpen, setThoughtsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const thoughts = useRef<HTMLDivElement>(null);
  const ranges = useRef<{ id: string; range: Range }[]>([]);

  const streaming = node.status === "streaming";
  const parked = node.status === "parked";
  const folded = !current && !expanded;
  const thinkingLive = streaming && !node.answer;
  const at = siblings.findIndex((s) => s.id === node.id);

  useEffect(() => {
    setNote(node.note ?? "");
  }, [node.note]);
  useEffect(() => {
    if (current) setExpanded(false);
  }, [current]);

  // Paint the passages that branches grew from, once the answer has settled.
  const quoteKey = quotes.map((q) => q.id + q.text).join("|");
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || folded || streaming || !quotes.length) {
      ranges.current = [];
      setQuoteRanges(node.id, []);
      return;
    }
    ranges.current = quotes.flatMap((q) => {
      const range = findRange(el, q.text);
      return range ? [{ id: q.id, range }] : [];
    });
    setQuoteRanges(node.id, ranges.current.map((r) => r.range));
    return () => setQuoteRanges(node.id, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.answer, quoteKey, folded, streaming]);

  useEffect(() => {
    if (thinkingLive && thoughts.current) thoughts.current.scrollTop = thoughts.current.scrollHeight;
  }, [thinkingLive, node.thinking]);

  const hit = (x: number, y: number) => ranges.current.find((r) => rangeContainsPoint(r.range, x, y));

  const saveEdit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== node.question) ws.patchNode(node.id, { question: draft.trim() });
  };

  const meta = [shortModel(node.model), node.usage && `${node.usage.input.toLocaleString()} → ${node.usage.output.toLocaleString()} tok`, formatCost(node.usage?.cost)].filter(Boolean).join("  ·  ");

  return (
    <section className={"ex" + (current ? " current" : "") + (folded ? " folded" : "") + (parked ? " is-parked" : "")} data-ex={node.id}>
      {node.quote && <blockquote className="ex-quote">{node.quote}</blockquote>}

      <div className="ex-head">
        {editing ? (
          <textarea
            className="ex-edit"
            autoFocus
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), saveEdit());
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <h2 className="ex-q" onClick={folded ? () => ws.select(node.id) : undefined}>{node.question}</h2>
        )}
        {siblings.length > 1 && (
          <span className="sibs">
            <button className="icon-btn" disabled={at <= 0} onClick={() => ws.select(siblings[at - 1].id)} aria-label="Previous branch"><ChevronLeft size={14} /></button>
            {at + 1}/{siblings.length}
            <button className="icon-btn" disabled={at >= siblings.length - 1} onClick={() => ws.select(siblings[at + 1].id)} aria-label="Next branch"><ChevronRight size={14} /></button>
          </span>
        )}
        {!current && (
          <button className="icon-btn sm" onClick={() => setExpanded((v) => !v)} data-tip={expanded ? "Fold" : "Peek at the answer"} aria-label={expanded ? "Fold" : "Peek at the answer"} data-tip-pos="left">
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        )}
      </div>

      {folded ? (
        <div className="ex-peek" onClick={() => ws.select(node.id)}>
          {parked ? "Parked: not asked yet." : node.status === "error" ? (node.error ?? "Failed.") : plain(node.answer) || "…"}
        </div>
      ) : (
        <>
          {node.thinking && (
            <details className={"thinking" + (thinkingLive ? " live" : "")} open={thinkingLive || thoughtsOpen} onToggle={(e) => !thinkingLive && setThoughtsOpen(e.currentTarget.open)}>
              <summary>
                {thinkingLive ? <Loader2 size={13} className="spin" /> : <Brain size={13} />}
                {thinkingLive ? "Thinking" : node.thinkingMs ? `Thought for ${formatDuration(node.thinkingMs)}` : "Reasoning"}
                <ChevronRight size={13} className="chev" />
              </summary>
              <div className="thinking-text" ref={thoughts}>{node.thinking}</div>
            </details>
          )}

          {parked ? (
            <div className="ex-parked">
              <Clock size={16} style={{ color: "var(--violet)", flex: "none" }} />
              <span>Parked for later. Nothing has been asked yet.</span>
              <button className="btn sm primary" onClick={() => ws.runNode(node.id)}><Play size={12} fill="currentColor" /> Ask now</button>
            </div>
          ) : node.status === "error" ? (
            <div className="ex-body">
              {node.answer && <Markdown text={node.answer} />}
              <div className="ex-error" style={{ marginTop: node.answer ? 12 : 0 }}>
                <AlertTriangle size={16} style={{ flex: "none", marginTop: 2 }} />
                <span>{node.error ?? "Something went wrong."}</span>
                <button className="btn sm" onClick={() => ws.runNode(node.id)}><RefreshCw size={12} /> Retry</button>
              </div>
            </div>
          ) : (
            <div
              className="ex-body"
              ref={body}
              onClick={(e) => {
                if (!window.getSelection()?.isCollapsed) return;
                const h = hit(e.clientX, e.clientY);
                if (h) ws.select(h.id);
              }}
              onMouseMove={(e) => {
                if (ranges.current.length) e.currentTarget.style.cursor = hit(e.clientX, e.clientY) ? "pointer" : "";
              }}
            >
              {!node.answer && streaming && !node.thinking ? <span className="dots muted"><i /><i /><i /></span> : <Markdown text={node.answer} streaming={streaming && !!node.answer} />}
            </div>
          )}

          <div className="ex-foot">
            {streaming ? (
              <button className="btn sm ghost" onClick={() => ws.abort(node.id)}><Square size={11} fill="currentColor" /> Stop</button>
            ) : (
              <>
                {!parked && (
                  <button
                    className="icon-btn sm"
                    data-tip="Copy answer" aria-label="Copy answer"
                    onClick={() => {
                      void navigator.clipboard.writeText(node.answer);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                )}
                <button className={"icon-btn sm" + (node.bookmarked ? " on" : "")} data-tip={node.bookmarked ? "Remove bookmark" : "Bookmark"} aria-label={node.bookmarked ? "Remove bookmark" : "Bookmark"} onClick={() => ws.patchNode(node.id, { bookmarked: !node.bookmarked })}>
                  <Bookmark size={14} fill={node.bookmarked ? "currentColor" : "none"} />
                </button>
                <button className={"icon-btn sm" + (noteOpen || node.note ? " on" : "")} data-tip="Note to self" aria-label="Note to self" onClick={() => setNoteOpen((v) => !v)}><StickyNote size={14} /></button>
                {parked ? (
                  <button className="icon-btn sm" data-tip="Edit question" aria-label="Edit question" onClick={() => (setDraft(node.question), setEditing(true))}><Pencil size={14} /></button>
                ) : (
                  <>
                    <button className="icon-btn sm" data-tip="Edit and ask again as a new branch" aria-label="Edit and ask again as a new branch" onClick={() => onReask(node)}><Pencil size={14} /></button>
                    <button className="icon-btn sm" data-tip="Regenerate with the current model" aria-label="Regenerate with the current model" onClick={() => ws.runNode(node.id)}><RefreshCw size={14} /></button>
                  </>
                )}
                <button className="icon-btn sm" data-tip="Delete this branch" aria-label="Delete this branch" onClick={() => void ws.deleteNode(node.id)}><Trash2 size={14} /></button>
              </>
            )}
            {!parked && <span className="meta">{meta}</span>}
          </div>

          {(noteOpen || node.note) && (
            <textarea className="note" placeholder="A note to your future self" value={note} autoFocus={noteOpen && !node.note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (node.note ?? "") && ws.patchNode(node.id, { note })} />
          )}
        </>
      )}
    </section>
  );
});
