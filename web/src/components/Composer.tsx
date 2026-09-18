import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Clock, MessageSquareQuote, Square, X } from "lucide-react";
import { ALT, MOD } from "../lib/prefs";

export interface ComposerHandle {
  focus(): void;
  fill(text: string): void;
}

interface Props {
  placeholder: string;
  quote?: string | null;
  onClearQuote?: () => void;
  /** Resolve false to keep the text (for example when a key is still needed). */
  onAsk: (text: string, stay: boolean) => Promise<boolean> | boolean;
  onPark?: (text: string) => Promise<boolean> | boolean;
  streaming?: boolean;
  onStop?: () => void;
  left?: ReactNode;
  autoFocus?: boolean;
  hints?: boolean;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { placeholder, quote, onClearQuote, onAsk, onPark, streaming, onStop, left, autoFocus, hints },
  ref,
) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    fill: (t) => {
      setText(t);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(t.length, t.length);
      });
    },
  }));

  // Grow with the text. Re-measure when the width changes too (pane resize, pane opening), and never
  // measure an empty box: a zero-width textarea wraps its placeholder into a tower.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => {
      el.style.height = "";
      if (el.value) el.style.height = `${Math.min(220, el.scrollHeight)}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el.parentElement!);
    return () => observer.disconnect();
  }, [text]);

  const submit = async (how: "ask" | "stay" | "park") => {
    const value = text.trim();
    if (!value) return;
    if (how !== "park" && streaming) return;
    const ok = how === "park" ? await onPark?.(value) : await onAsk(value, how === "stay");
    if (ok) setText("");
  };

  return (
    <>
      <div className="composer">
        {quote && (
          <div className="quote-chip">
            <MessageSquareQuote size={14} style={{ flex: "none", marginTop: 2, color: "var(--teal)" }} />
            <span>{quote}</span>
            <button className="icon-btn sm" onClick={onClearQuote} aria-label="Remove quote"><X size={13} /></button>
          </div>
        )}
        <textarea
          ref={area}
          rows={1}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit(e.altKey && onPark ? "park" : e.metaKey || e.ctrlKey ? "stay" : "ask");
            } else if (e.key === "Escape") e.currentTarget.blur();
          }}
        />
        <div className="composer-row">
          {left}
          <span className="spacer" />
          {onPark && (
            <button className="icon-btn" disabled={!text.trim()} onClick={() => void submit("park")} data-tip={`Park for later (${ALT}↵)`} aria-label="Park for later">
              <Clock size={16} />
            </button>
          )}
          {streaming ? (
            <button className="send stop" onClick={onStop} data-tip="Stop" aria-label="Stop generating"><Square size={13} fill="currentColor" /></button>
          ) : (
            <button className="send" disabled={!text.trim()} onClick={() => void submit("ask")} aria-label="Ask"><ArrowUp size={17} strokeWidth={2.4} /></button>
          )}
        </div>
      </div>
      {hints && (
        <div className="hints">
          <span><kbd>↵</kbd> ask</span>
          <span><kbd>{MOD}</kbd><kbd>↵</kbd> ask, keep reading</span>
          <span><kbd>{ALT}</kbd><kbd>↵</kbd> park for later</span>
        </div>
      )}
    </>
  );
});
