import { useEffect, useRef, useState } from "react";
import { Clock, Download, FileJson, FileText, MoreHorizontal, PanelLeftOpen, Search, Trash2, Upload } from "lucide-react";
import { useWorkspace } from "../state/workspace";

/** Floating over the canvas: what topic this is, what is waiting in it, and the topic menu. */
export function Toolbar({ sidebarOpen, onOpenSidebar }: { sidebarOpen: boolean; onOpenSidebar: () => void }) {
  const ws = useWorkspace();
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  const item = (run: () => void) => () => (setMenu(false), run());

  return (
    <div className="float toolbar" ref={root}>
      {!sidebarOpen && <button className="icon-btn" onClick={onOpenSidebar} data-tip="Show sidebar  [" aria-label="Show sidebar" data-tip-pos="bottom"><PanelLeftOpen size={16} /></button>}
      {ws.tree ? (
        <>
          <input
            className="title"
            key={ws.tree.id + ws.tree.title}
            defaultValue={ws.tree.title}
            aria-label="Topic title"
            spellCheck={false}
            onBlur={(e) => void ws.renameTopic(e.target.value)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
          />
          {ws.counts.unread > 0 && (
            <button className="pill unread" onClick={ws.nextUnread} data-tip="Jump to the next unread answer  U" aria-label="Jump to the next unread answer" data-tip-pos="bottom">
              <span style={{ width: 7, height: 7, borderRadius: 7, background: "currentColor" }} /> <span className="count">{ws.counts.unread}</span> unread
            </button>
          )}
          {ws.counts.parked > 0 && (
            <button className="pill parked" onClick={ws.nextParked} data-tip="Jump to the next parked question  P" aria-label="Jump to the next parked question" data-tip-pos="bottom">
              <Clock size={12} /> <span className="count">{ws.counts.parked}</span> parked
            </button>
          )}
          <span className="sep" />
        </>
      ) : null}
      <button className="icon-btn" onClick={() => ws.setPaletteOpen(true)} data-tip="Search" aria-label="Search" data-tip-pos="bottom"><Search size={15} /></button>
      {ws.tree && <button className={"icon-btn" + (menu ? " on" : "")} onClick={() => setMenu((m) => !m)} aria-label="Topic menu"><MoreHorizontal size={16} /></button>}
      {menu && (
        <div className="menu" style={{ top: "calc(100% + 8px)", right: 0 }}>
          <button className="menu-item" onClick={item(() => ws.exportTopic("md"))}><FileText size={15} /> Export as Markdown</button>
          <button className="menu-item" onClick={item(() => ws.exportTopic("json"))}><FileJson size={15} /> Export as JSON</button>
          <button className="menu-item" onClick={item(() => void ws.importTrees())}><Upload size={15} /> Import a topic</button>
          <button className="menu-item" onClick={item(() => void ws.exportAll())}><Download size={15} /> Back up all topics</button>
          <div className="menu-sep" />
          <button className="menu-item danger" onClick={item(() => void ws.deleteTopic(ws.tree!.id))}><Trash2 size={15} /> Delete topic</button>
        </div>
      )}
    </div>
  );
}
