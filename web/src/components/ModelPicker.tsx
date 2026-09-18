import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Check, ChevronUp, Cpu, Star } from "lucide-react";
import type { ModelInfo } from "@shared/types";
import { useWorkspace } from "../state/workspace";
import { shortModel } from "../lib/misc";

export function ModelPicker() {
  const { catalog, refreshCatalog, model, thinking, setModel, backend } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const models = catalog?.models ?? [];
  const current = models.find((m) => m.id === model);
  const vault = backend.vault;

  useEffect(() => {
    if (!open) return;
    void refreshCatalog(); // picks up changes made in pi (or new OpenRouter models) since the page loaded
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open, refreshCatalog]);

  const { top, rest } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = models.filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
    return { top: hit.filter((m) => m.enabled), rest: hit.filter((m) => !m.enabled).slice(0, q ? 150 : 30) };
  }, [models, query]);

  const levels = current?.thinkingLevels.length ? current.thinkingLevels : [];
  const level = thinking && levels.includes(thinking) ? thinking : levels.includes("medium") ? "medium" : levels[0];
  const levelFor = (m: ModelInfo) => (level && m.thinkingLevels.includes(level) ? level : m.thinkingLevels.includes("medium") ? "medium" : (m.thinkingLevels[0] ?? "off"));

  const Item = ({ m }: { m: ModelInfo }) => (
    <button className={"model-item" + (m.id === model ? " on" : "")} onClick={() => setModel(m.id, levelFor(m))}>
      {m.id === model ? <Check size={13} /> : <span style={{ width: 13, flex: "none" }} />}
      <span className="nm">{m.name}</span>
      <span className="prov">{m.provider}</span>
      <span className="cost">{m.cost.input < 0 || m.cost.output < 0 ? "varies" : m.cost.input === 0 && m.cost.output === 0 ? "free" : `$${+m.cost.input.toFixed(2)} / $${+m.cost.output.toFixed(2)}`}</span>
      {vault && (
        <span
          role="button"
          className={"star" + (vault.favorites().includes(m.id) ? " on" : "")}
          onClick={(e) => {
            e.stopPropagation();
            vault.toggleFavorite(m.id);
            void refreshCatalog();
          }}
        >
          <Star size={13} fill={vault.favorites().includes(m.id) ? "currentColor" : "none"} />
        </span>
      )}
    </button>
  );

  return (
    <div className="model-picker" ref={root}>
      <button className="model-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Cpu size={13} style={{ flex: "none" }} />
        <span className="name">{current?.name ?? (model ? shortModel(model) : "Choose a model")}</span>
        {current?.reasoning && level && level !== "off" && level !== "auto" && <span className="lvl">{level}</span>}
        <ChevronUp size={12} style={{ flex: "none", opacity: 0.6, transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
      </button>
      {open && (
        <div className="model-menu">
          <input className="input" autoFocus placeholder="Search models" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="model-list">
            {top.length > 0 && <div className="model-group">{vault ? "Recommended and starred" : "Enabled in pi"}</div>}
            {top.map((m) => <Item key={m.id} m={m} />)}
            {rest.length > 0 && <div className="model-group">{query ? "More matches" : "All models (search for more)"}</div>}
            {rest.map((m) => <Item key={m.id} m={m} />)}
            {!top.length && !rest.length && <div className="palette-empty">{models.length ? "No model matches." : (catalog?.emptyHint ?? "No models available yet.")}</div>}
          </div>
          {current && levels.length > 1 && (
            <div className="levels">
              <span className="lbl"><Brain size={12} /> Thinking</span>
              {levels.map((l) => (
                <button key={l} className={"level" + (l === level ? " on" : "")} onClick={() => setModel(current.id, l)}>{l}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
