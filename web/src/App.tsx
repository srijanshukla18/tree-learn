import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, GitBranch, HelpCircle } from "lucide-react";
import type { Backend } from "./backend/types";
import { backendReady } from "./backend";
import { computeLayout } from "./lib/layout";
import { usePref } from "./lib/prefs";
import { useWorkspaceState, WorkspaceProvider } from "./state/workspace";
import { CommandPalette } from "./components/CommandPalette";
import type { ComposerHandle } from "./components/Composer";
import { ConnectDialog, SettingsDialog, ShortcutsDialog } from "./components/Dialogs";
import { Hero } from "./components/Hero";
import { Sidebar } from "./components/Sidebar";
import { ThreadPane } from "./components/ThreadPane";
import { Toasts } from "./components/Toasts";
import { Toolbar } from "./components/Toolbar";
import { TreeCanvas } from "./components/TreeCanvas";

const narrow = () => window.innerWidth <= 860;

function Boot() {
  return (
    <div className="boot">
      <div className="boot-mark"><GitBranch size={20} strokeWidth={2.4} /></div>
    </div>
  );
}

export function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    backendReady.then(setBackend, (e) => setError(String(e?.message ?? e)));
  }, []);
  if (error) return <div className="boot">{error}</div>;
  return backend ? <Workspace backend={backend} /> : <Boot />;
}

function Workspace({ backend }: { backend: Backend }) {
  const ws = useWorkspaceState(backend);
  const [sidebarOpen, setSidebarOpen] = usePref("sidebar", !narrow());
  const [paneOpen, setPaneOpen] = usePref("pane", true);
  const [paneWidth, setPaneWidth] = usePref("pane-width", Math.round(Math.min(640, Math.max(420, window.innerWidth * 0.38))));
  const [resizing, setResizing] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const wsRef = useRef(ws);
  wsRef.current = ws;

  const hasNodes = !!ws.tree && Object.keys(ws.tree.nodes).length > 0;
  const showPane = hasNodes && paneOpen;

  const focusComposer = useCallback(() => {
    composer.current?.focus(); // right now, so the very next keystroke already lands in the box
    setPaneOpen(true);
    setTimeout(() => composer.current?.focus(), 60); // and again once a closed pane has opened
  }, [setPaneOpen]);

  const branchFrom = useCallback(
    (nodeId: string) => {
      wsRef.current.select(nodeId);
      focusComposer();
    },
    [focusComposer],
  );

  // Drag the pane's left edge to resize it.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const move = (ev: PointerEvent) => setPaneWidth(Math.round(Math.min(window.innerWidth * 0.7, Math.max(380, window.innerWidth - ev.clientX))));
    const up = () => {
      setResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const w = wsRef.current;
      const target = e.target as HTMLElement;
      const typing = target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") return e.preventDefault(), w.setPaletteOpen(!w.paletteOpen);
      if (typing || w.paletteOpen || w.dialog || e.metaKey || e.ctrlKey || e.altKey) return;

      const t = w.tree;
      const cur = w.selected;
      const go = (id?: string | null) => id !== undefined && (e.preventDefault(), w.select(id));
      switch (e.key) {
        case "/": return e.preventDefault(), focusComposer();
        case "?": return w.setDialog("shortcuts");
        case "[": return setSidebarOpen((v) => !v);
        case "]": return setPaneOpen((v) => !v);
        case "n": return w.newTopic();
        case "u": return w.nextUnread();
        case "p": return w.nextParked();
        case "o": return go(null);
        case "f": return void window.dispatchEvent(new Event("tree-learn:fit"));
      }
      if (!t) return;
      if (e.key === "ArrowLeft") return go(cur?.parentId ?? (cur ? undefined : undefined));
      if (e.key === "ArrowRight") return go(cur ? (cur.collapsed ? undefined : w.preferredChild(cur.id)?.id) : w.childrenOf(null)[0]?.id);
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        // Move to what is visually above or below: the neighbour in the same column of the tree.
        const placed = computeLayout(t).nodes;
        const me = placed.find((p) => p.id === cur?.id);
        if (!me) return go(placed[0]?.id);
        const column = placed.filter((p) => p.depth === me.depth).sort((a, b) => a.y - b.y);
        return go(column[column.findIndex((p) => p.id === me.id) + (e.key === "ArrowDown" ? 1 : -1)]?.id);
      }
      if (!cur) return;
      if (e.key === "Enter" && cur.status === "parked") return e.preventDefault(), w.runNode(cur.id);
      if (e.key === "b") return w.patchNode(cur.id, { bookmarked: !cur.bookmarked });
      if (e.key === "c" && w.childrenOf(cur.id).length) return w.patchNode(cur.id, { collapsed: !cur.collapsed });
      if (e.key === "r" && cur.status === "done") return void w.suggest(cur.id);
      if (e.key === "Backspace" || e.key === "Delete") return void w.deleteNode(cur.id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focusComposer, setPaneOpen, setSidebarOpen]);

  if (!ws.ready) return <Boot />;

  return (
    <WorkspaceProvider value={ws}>
      <div
        className={"app" + (sidebarOpen ? "" : " no-sidebar") + (showPane ? "" : " no-pane") + (resizing ? " resizing" : "")}
        style={{ ["--pane-w" as string]: `${paneWidth}px` }}
      >
        <Sidebar onCollapse={() => setSidebarOpen(false)} onPick={() => narrow() && setSidebarOpen(false)} />
        <div className="scrim" onClick={() => setSidebarOpen(false)} />

        <main className="stage">
          <Toolbar sidebarOpen={sidebarOpen} onOpenSidebar={() => setSidebarOpen(true)} />
          {hasNodes ? <TreeCanvas onBranch={branchFrom} /> : <><div className="canvas-dots" style={{ backgroundSize: "22px 22px" }} /><div className="canvas-vignette" /><Hero composer={composer} /></>}
          {hasNodes && !paneOpen && (
            <div className="float stage-corner">
              <button className="btn sm ghost" onClick={() => setPaneOpen(true)}><BookOpen size={14} /> Read</button>
            </div>
          )}
          {hasNodes && (
            <div className="float help">
              <button className="icon-btn" onClick={() => ws.setDialog("shortcuts")} data-tip="Shortcuts  ?" aria-label="Shortcuts" data-tip-pos="right"><HelpCircle size={16} /></button>
            </div>
          )}
        </main>

        {hasNodes ? (
          <ThreadPane composer={composer} onCollapse={() => setPaneOpen(false)} resizer={<div className="pane-resizer" onPointerDown={startResize} />} />
        ) : (
          <aside className="pane" />
        )}
      </div>

      {ws.paletteOpen && <CommandPalette />}
      {ws.dialog === "settings" && <SettingsDialog />}
      {ws.dialog === "shortcuts" && <ShortcutsDialog />}
      {ws.dialog === "connect" && <ConnectDialog />}
      <Toasts />
    </WorkspaceProvider>
  );
}
