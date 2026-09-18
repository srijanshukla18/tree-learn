import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Clock, CornerDownRight, Download, FileText, GitBranch, Keyboard, KeyRound, MessageSquare, Monitor, Plus, Search, Settings, StickyNote, Upload } from "lucide-react";
import type { SearchHit } from "@shared/types";
import { useWorkspace } from "../state/workspace";
import { useTheme } from "../lib/prefs";

interface Item {
  key: string;
  group: string;
  icon: ReactNode;
  line: ReactNode;
  sub?: ReactNode;
  where?: string;
  run: () => void;
}

function mark(text: string, terms: string[]) {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export function CommandPalette() {
  const ws = useWorkspace();
  const [theme, setTheme] = useTheme();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const close = () => ws.setPaletteOpen(false);
  const q = query.trim().toLowerCase();
  const terms = useMemo(() => q.split(/\s+/).filter(Boolean), [q]);

  useEffect(() => {
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => ws.backend.search(q).then((r) => !stale && setHits(r)).catch(() => {}), 130);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q, ws.backend]);

  const items = useMemo(() => {
    const vault = ws.backend.vault;
    const actions: Item[] = [
      { key: "new", group: "Actions", icon: <Plus size={15} />, line: "New topic", run: ws.newTopic },
      ...(ws.counts.unread ? [{ key: "unread", group: "Actions", icon: <MessageSquare size={15} />, line: `Next unread answer (${ws.counts.unread})`, run: ws.nextUnread }] : []),
      ...(ws.counts.parked ? [{ key: "parked", group: "Actions", icon: <Clock size={15} />, line: `Next parked question (${ws.counts.parked})`, run: ws.nextParked }] : []),
      ...(ws.tree ? [{ key: "md", group: "Actions", icon: <FileText size={15} />, line: "Export this topic as Markdown", run: () => ws.exportTopic("md") }] : []),
      { key: "backup", group: "Actions", icon: <Download size={15} />, line: "Back up all topics", run: () => void ws.exportAll() },
      { key: "import", group: "Actions", icon: <Upload size={15} />, line: "Import topics from a file", run: () => void ws.importTrees() },
      { key: "theme", group: "Actions", icon: <Monitor size={15} />, line: `Switch theme (now: ${theme})`, run: () => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark") },
      ...(vault ? [{ key: "key", group: "Actions", icon: <KeyRound size={15} />, line: vault.hasKey() ? "Manage OpenRouter connection" : "Connect OpenRouter", run: () => ws.setDialog(vault.hasKey() ? "settings" : "connect") }] : []),
      { key: "settings", group: "Actions", icon: <Settings size={15} />, line: "Settings", run: () => ws.setDialog("settings") },
      { key: "keys", group: "Actions", icon: <Keyboard size={15} />, line: "Keyboard shortcuts", run: () => ws.setDialog("shortcuts") },
    ].filter((a) => !q || (typeof a.line === "string" && a.line.toLowerCase().includes(q)));

    const topics: Item[] = ws.trees
      .filter((t) => !q || terms.every((term) => t.title.toLowerCase().includes(term)))
      .slice(0, q ? 8 : 6)
      .map((t) => ({ key: `t:${t.id}`, group: "Topics", icon: <GitBranch size={15} />, line: mark(t.title, terms), sub: `${t.nodeCount} nodes`, run: () => void ws.openTree(t.id) }));

    const found: Item[] = hits
      .filter((h) => h.nodeId)
      .map((h) => ({
        key: `n:${h.treeId}:${h.nodeId}`,
        group: "In your notes",
        icon: h.field === "note" ? <StickyNote size={15} /> : <CornerDownRight size={15} />,
        line: mark(h.question ?? "", terms),
        sub: h.field === "question" ? undefined : mark(h.snippet, terms),
        where: h.treeTitle,
        run: () => void ws.openTree(h.treeId, h.nodeId),
      }));
    return q ? [...topics, ...found, ...actions] : [...actions.slice(0, 3), ...topics, ...actions.slice(3)];
  }, [q, terms, hits, ws, theme, setTheme]);

  useEffect(() => {
    setActive(0);
  }, [q, hits.length]);
  useEffect(() => {
    list.current?.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (item?: Item) => {
    if (!item) return;
    close();
    item.run();
  };

  let lastGroup = "";
  return (
    <div className="backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Search and commands">
        <div className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Search your topics, questions and answers, or run a command"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(items.length - 1, a + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
              else if (e.key === "Enter") (e.preventDefault(), run(items[active]));
              else if (e.key === "Escape") close();
            }}
          />
        </div>
        <div className="palette-list" ref={list}>
          {items.length === 0 && <div className="palette-empty">Nothing matches “{query}”.</div>}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? <div className="palette-group">{item.group}</div> : null;
            lastGroup = item.group;
            return (
              <div key={item.key}>
                {header}
                <button className={"palette-item" + (i === active ? " active" : "")} onMouseMove={() => setActive(i)} onClick={() => run(item)}>
                  {item.icon}
                  <span className="main">
                    <span className="line" style={{ display: "block" }}>{item.line}</span>
                    {item.sub && <span className="sub" style={{ display: "block" }}>{item.sub}</span>}
                  </span>
                  {item.where && <span className="where">{item.where}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
