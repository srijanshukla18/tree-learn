import { useEffect, useState, type ReactNode } from "react";
import { Check, Download, ExternalLink, KeyRound, Monitor, Moon, Sun, Upload, X } from "lucide-react";
import { useWorkspace } from "../state/workspace";
import { ALT, MOD, useTheme, type ThemePref } from "../lib/prefs";
import { TrustPoints } from "./Hero";

function Dialog({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  const { setDialog } = useWorkspace();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDialog(null);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [setDialog]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
      <div className={"dialog" + (wide ? " wide" : "")} role="dialog" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={() => setDialog(null)} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

/** Hosted mode: get a key from OpenRouter with one click, or paste one. */
function KeyForm({ onDone }: { onDone?: () => void }) {
  const ws = useWorkspace();
  const vault = ws.backend.vault!;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="btn primary lg"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          vault.beginConnect().catch((err) => (setBusy(false), ws.toast(String(err.message ?? err), { kind: "error" })));
        }}
      >
        <KeyRound size={16} /> {busy ? "Opening OpenRouter…" : "Connect with OpenRouter"}
      </button>
      <p style={{ fontSize: 12.5 }}>
        You approve this app on openrouter.ai and it receives its own key, which you can cap with a spending limit or revoke at any time from your{" "}
        <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer noopener">OpenRouter keys page</a>.
      </p>
      <div className="divider-or">or paste a key</div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!key.trim()) return;
          vault.setKey(key);
          setKey("");
          ws.toast("Key saved in this browser.");
          onDone?.();
        }}
      >
        <input className="input grow" type="password" autoComplete="off" spellCheck={false} placeholder="sk-or-v1-…" value={key} onChange={(e) => setKey(e.target.value)} />
        <button className="btn" type="submit" disabled={!key.trim()}>Save</button>
      </form>
    </>
  );
}

export function ConnectDialog() {
  const { setDialog } = useWorkspace();
  return (
    <Dialog title="Bring your own OpenRouter key">
      <p>Tree Learn talks to models through your own OpenRouter account, so you pay OpenRouter directly for what you use and nobody sits in between.</p>
      <TrustPoints />
      <KeyForm onDone={() => setDialog(null)} />
    </Dialog>
  );
}

export function SettingsDialog() {
  const ws = useWorkspace();
  const [theme, setTheme] = useTheme();
  const vault = ws.backend.vault;
  const themes: [ThemePref, string, ReactNode][] = [["system", "System", <Monitor size={13} key="s" />], ["light", "Light", <Sun size={13} key="l" />], ["dark", "Dark", <Moon size={13} key="d" />]];
  return (
    <Dialog title="Settings">
      <div className="section">
        <h3>Appearance</h3>
        <div className="segmented" style={{ alignSelf: "flex-start" }}>
          {themes.map(([id, label, icon]) => <button key={id} className={theme === id ? "on" : ""} onClick={() => setTheme(id)}>{icon} {label}</button>)}
        </div>
      </div>

      <div className="section">
        <h3>Models</h3>
        {vault ? (
          vault.hasKey() ? (
            <div className="key-status">
              <Check size={16} style={{ color: "var(--teal)" }} />
              <span className="grow">Connected to OpenRouter <code>…{vault.hint()}</code></span>
              <button className="btn sm danger" onClick={() => (vault.clearKey(), ws.toast("Key removed from this browser."))}>Disconnect</button>
            </div>
          ) : (
            <KeyForm />
          )
        ) : (
          <p>
            Running locally through <b>pi</b>. Providers, models and logins come from <code>~/.pi/agent</code>, and changes you make in pi show up here the next time you open the model menu.
          </p>
        )}
      </div>

      <div className="section">
        <h3>Your data</h3>
        <p>{vault ? "Topics are stored in this browser only. Back them up if they matter: clearing site data deletes them." : "Topics are JSON files in the project's data folder."}</p>
        <div className="row">
          <button className="btn" onClick={() => void ws.exportAll()}><Download size={14} /> Back up all topics</button>
          <button className="btn" onClick={() => void ws.importTrees()}><Upload size={14} /> Import</button>
        </div>
      </div>

      {import.meta.env.VITE_REPO_URL && (
        <div className="section">
          <a className="btn ghost" style={{ alignSelf: "flex-start" }} href={import.meta.env.VITE_REPO_URL} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} /> Source code</a>
        </div>
      )}
    </Dialog>
  );
}

const K = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>;

export function ShortcutsDialog() {
  const rows: [string, ReactNode][] = [
    ["Ask", <K key="a">↵</K>],
    ["Ask and keep reading", <><K>{MOD}</K><K>↵</K></>],
    ["Park a question for later", <><K>{ALT}</K><K>↵</K></>],
    ["Focus the question box", <K key="s">/</K>],
    ["Search everything", <><K>{MOD}</K><K>K</K></>],
    ["Parent / child", <><K>←</K><K>→</K></>],
    ["Node above / below", <><K>↑</K><K>↓</K></>],
    ["Ask the selected parked question", <K key="e">↵</K>],
    ["Next unread answer", <K key="u">U</K>],
    ["Next parked question", <K key="p">P</K>],
    ["Suggest rabbit holes", <K key="r">R</K>],
    ["Bookmark", <K key="b">B</K>],
    ["Fold or unfold branches", <K key="c">C</K>],
    ["Fit the tree", <K key="f">F</K>],
    ["Topic overview", <K key="o">O</K>],
    ["New topic", <K key="n">N</K>],
    ["Delete node (undo available)", <K key="d">⌫</K>],
    ["Sidebar / reading pane", <><K>[</K><K>]</K></>],
    ["Back to where you were", <>browser back</>],
    ["This list", <K key="q">?</K>],
  ];
  return (
    <Dialog title="Keyboard shortcuts" wide>
      <div className="shortcuts">
        {rows.map(([label, keys]) => <div className="shortcut" key={label}><span>{label}</span><span>{keys}</span></div>)}
      </div>
      <p style={{ fontSize: 12.5 }}>On the canvas: drag to pan, pinch or {MOD} + scroll to zoom, double-click empty space to fit, double-click a node to branch from it. In an answer: select any text to ask about it.</p>
    </Dialog>
  );
}
