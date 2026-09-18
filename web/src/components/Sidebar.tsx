import { Clock, GitBranch, Keyboard, PanelLeftClose, Plus, Search, Settings, Trash2 } from "lucide-react";
import { useWorkspace } from "../state/workspace";
import { timeAgo } from "../lib/misc";
import { MOD } from "../lib/prefs";
import type { TreeSummary } from "@shared/types";

export function Sidebar({ onCollapse, onPick }: { onCollapse: () => void; onPick: () => void }) {
  const ws = useWorkspace();
  const day = 86_400_000;
  const groups: [string, TreeSummary[]][] = [
    ["Today", ws.trees.filter((t) => Date.now() - t.updatedAt < day)],
    ["This week", ws.trees.filter((t) => Date.now() - t.updatedAt >= day && Date.now() - t.updatedAt < 7 * day)],
    ["Earlier", ws.trees.filter((t) => Date.now() - t.updatedAt >= 7 * day)],
  ];
  const vault = ws.backend.vault;
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-mark"><GitBranch size={15} strokeWidth={2.4} /></span>
          Tree Learn
        </div>
        <button className="icon-btn sm" onClick={onCollapse} data-tip="Hide sidebar  [" aria-label="Hide sidebar" data-tip-pos="left"><PanelLeftClose size={15} /></button>
      </div>
      <div className="sidebar-actions">
        <button className="btn primary" onClick={() => (ws.newTopic(), onPick())}><Plus size={15} strokeWidth={2.4} /> New topic</button>
      </div>
      <div className="sidebar-actions">
        <button className="btn search-btn" onClick={() => ws.setPaletteOpen(true)}><Search size={14} /> Search everything <kbd>{MOD}K</kbd></button>
      </div>
      <nav className="topics">
        {ws.trees.length === 0 && <div className="topics-empty">Your topics will collect here. Each one is a tree of questions you can come back to.</div>}
        {groups.filter(([, list]) => list.length).map(([label, list]) => (
          <div key={label}>
            <div className="topics-label">{label}</div>
            {list.map((t) => (
              <button key={t.id} className={"topic" + (t.id === ws.tree?.id ? " active" : "")} onClick={() => (void ws.openTree(t.id), onPick())}>
                <span className="topic-row">
                  <span className="topic-title">{t.title}</span>
                  {t.unread > 0 && <span className="badge unread">{t.unread}</span>}
                  {t.parked > 0 && <span className="badge parked"><Clock size={10} />{t.parked}</span>}
                </span>
                <span className="topic-meta">{t.nodeCount} {t.nodeCount === 1 ? "node" : "nodes"} · {timeAgo(t.updatedAt)}</span>
                <span role="button" className="icon-btn sm topic-del" aria-label={`Delete ${t.title}`} onClick={(e) => (e.stopPropagation(), void ws.deleteTopic(t.id))}><Trash2 size={13} /></span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <button className="icon-btn" onClick={() => ws.setDialog("settings")} data-tip="Settings" aria-label="Settings" data-tip-pos="right"><Settings size={16} /></button>
        <button className="icon-btn" onClick={() => ws.setDialog("shortcuts")} data-tip="Keyboard shortcuts  ?" aria-label="Keyboard shortcuts" data-tip-pos="right"><Keyboard size={16} /></button>
        <span className="mode">
          <span className={"mode-dot" + (vault && !vault.hasKey() ? " warn" : "")} />
          {vault ? (vault.hasKey() ? "OpenRouter connected" : "Not connected") : "Models via pi"}
        </span>
      </div>
    </aside>
  );
}
