import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { childrenOf, isTree, pathTo, toMarkdown } from "@shared/tree";
import type { ModelCatalog, NodePatch, StreamSink, Tree, TreeNode, TreeSummary } from "@shared/types";
import type { Backend } from "../backend/types";
import { download, pickFile, slug } from "../lib/misc";
import { readPref, writePref } from "../lib/prefs";
import { readRoute, writeRoute } from "../lib/router";

export interface Quote {
  nodeId: string;
  text: string;
}
export interface Toast {
  id: number;
  message: string;
  kind?: "error";
  action?: { label: string; run: () => void };
}
export type DialogName = "settings" | "shortcuts" | "connect" | null;
export interface AskOptions {
  quote?: string;
  /** Defaults to the selected node. `null` starts a new root. */
  parentId?: string | null;
  /** Keep reading where you are; the answer arrives in the background. */
  stay?: boolean;
}

export type Workspace = ReturnType<typeof useWorkspaceState>;
const Ctx = createContext<Workspace | null>(null);
export const WorkspaceProvider = Ctx.Provider;
export function useWorkspace(): Workspace {
  const ws = useContext(Ctx);
  if (!ws) throw new Error("WorkspaceProvider is missing");
  return ws;
}

let toastSeq = 0;

export function useWorkspaceState(backend: Backend) {
  const [ready, setReady] = useState(false);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [model, setModelState] = useState<string | undefined>();
  const [thinking, setThinkingState] = useState<string | undefined>();
  const [trees, setTrees] = useState<TreeSummary[]>([]);
  const [tree, setTree] = useState<Tree | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [suggesting, setSuggesting] = useState<Set<string>>(new Set());
  const [, setVaultTick] = useState(0);

  // Callbacks that outlive a render read the latest values through refs.
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const modelRef = useRef({ model, thinking });
  modelRef.current = { model, thinking };
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  /** Nodes this tab is writing; background sync must not overwrite them with older copies. */
  const localStreaming = useRef(new Set<string>());
  /** For each node, the child the learner last went through, so stepping right retraces their route. */
  const lastChild = useRef(new Map<string, string>());

  // ---------- toasts ----------
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (message: string, opts: { kind?: "error"; action?: Toast["action"]; ms?: number } = {}) => {
      const id = ++toastSeq;
      setToasts((ts) => [...ts.slice(-2), { id, message, kind: opts.kind, action: opts.action }]);
      window.setTimeout(() => dismissToast(id), opts.ms ?? (opts.action ? 10_000 : 4200));
    },
    [dismissToast],
  );
  const fail = useCallback((err: unknown) => toast(err instanceof Error ? err.message : String(err), { kind: "error" }), [toast]);

  // ---------- catalog / model ----------
  const refreshCatalog = useCallback(async () => {
    try {
      const c = await backend.models();
      setCatalog(c);
      return c;
    } catch (err) {
      fail(err);
      return null;
    }
  }, [backend, fail]);

  const setModel = useCallback(
    (m: string, level: string) => {
      setModelState(m);
      setThinkingState(level);
      const t = treeRef.current;
      if (t) backend.updateTree(t.id, { model: m, thinkingLevel: level }).catch(() => {});
    },
    [backend],
  );

  const refreshTrees = useCallback(() => backend.listTrees().then(setTrees).catch(fail), [backend, fail]);

  // ---------- selection ----------
  const select = useCallback((id: string | null, mode: "push" | "replace" = "push") => {
    const t = treeRef.current;
    setSelectedId(id);
    setQuote(null);
    if (!t) return;
    if (id) {
      const route = pathTo(t, id);
      for (let i = 1; i < route.length; i++) lastChild.current.set(route[i - 1].id, route[i].id);
      writePref(`last-node:${t.id}`, id);
    }
    writeRoute({ treeId: t.id, nodeId: id ?? undefined }, mode);
  }, []);

  const openTree = useCallback(
    async (id: string, nodeId?: string, mode: "push" | "replace" = "push") => {
      try {
        const t = await backend.getTree(id);
        treeRef.current = t;
        setTree(t);
        writePref("last-tree", id);
        // A topic remembers its model, but one imported from the other mode names a model this catalog lacks.
        const known = catalogRef.current?.models.find((m) => m.id === t.model);
        if (known) {
          setModelState(known.id);
          if (t.thinkingLevel && known.thinkingLevels.includes(t.thinkingLevel)) setThinkingState(t.thinkingLevel);
        }
        const remembered = readPref<string | null>(`last-node:${id}`, null);
        // Return to where the learner left off; a topic never opened here (an import, the sample) starts at its root.
        const root = childrenOf(t, null)[0]?.id ?? null;
        const pick = nodeId && t.nodes[nodeId] ? nodeId : remembered && t.nodes[remembered] ? remembered : root;
        select(pick, mode);
      } catch (err) {
        fail(err);
      }
    },
    [backend, fail, select],
  );

  const newTopic = useCallback(() => {
    treeRef.current = null;
    setTree(null);
    setSelectedId(null);
    setQuote(null);
    writeRoute({});
  }, []);

  // ---------- streaming ----------
  const upsert = useCallback((treeId: string, node: TreeNode) => {
    setTree((t) => (t && t.id === treeId ? { ...t, nodes: { ...t.nodes, [node.id]: node } } : t));
  }, []);

  const pending = useRef(new Map<string, { answer: string; thinking: string }>());
  const flushTimer = useRef<number | null>(null);
  const flush = useCallback(() => {
    flushTimer.current = null;
    if (!pending.current.size) return;
    const batch = new Map(pending.current);
    pending.current.clear();
    setTree((t) => {
      if (!t) return t;
      const nodes = { ...t.nodes };
      for (const [id, d] of batch) {
        const n = nodes[id];
        if (n) nodes[id] = { ...n, answer: n.answer + d.answer, thinking: d.thinking ? (n.thinking ?? "") + d.thinking : n.thinking };
      }
      return { ...t, nodes };
    });
  }, []);
  const buffer = useCallback(
    (id: string, answer: string, thought: string) => {
      const cur = pending.current.get(id) ?? { answer: "", thinking: "" };
      cur.answer += answer;
      cur.thinking += thought;
      pending.current.set(id, cur);
      if (flushTimer.current !== null) return;
      // Long answers cost more to re-render as Markdown, so they repaint a little less often.
      const size = treeRef.current?.nodes[id]?.answer.length ?? 0;
      flushTimer.current = window.setTimeout(flush, 45 + Math.min(180, size / 90));
    },
    [flush],
  );

  const sinkFor = useCallback(
    (treeId: string, follow: boolean): StreamSink => {
      let nodeId = "";
      return {
        onNode(node) {
          nodeId = node.id;
          localStreaming.current.add(node.id);
          upsert(treeId, node);
          if (follow && treeRef.current?.id === treeId) {
            // The node is not in treeRef yet (state is async); patch the ref so select() can walk its path.
            treeRef.current = { ...treeRef.current, nodes: { ...treeRef.current.nodes, [node.id]: node } };
            select(node.id);
          }
        },
        onDelta: (text) => buffer(nodeId, text, ""),
        onThinking: (text) => buffer(nodeId, "", text),
        onTitle(title) {
          setTree((t) => (t && t.id === treeId ? { ...t, title } : t));
          void refreshTrees();
        },
        onDone(node) {
          flush();
          localStreaming.current.delete(node.id);
          const watching = selectedRef.current === node.id && treeRef.current?.id === treeId && !document.hidden;
          if (watching && node.unread) {
            node = { ...node, unread: undefined };
            backend.updateNode(treeId, node.id, { unread: false }).catch(() => {});
          }
          upsert(treeId, node);
          void refreshTrees();
        },
        onError(message, node) {
          flush();
          if (nodeId) localStreaming.current.delete(nodeId);
          if (node) upsert(treeId, node);
          toast(message, { kind: "error", ms: 7000 });
          void refreshTrees();
        },
      };
    },
    [backend, buffer, flush, refreshTrees, select, toast, upsert],
  );

  /** Hosted mode needs the learner's key before anything can be asked. */
  const ensureKey = useCallback(() => {
    if (!backend.vault || backend.vault.hasKey()) return true;
    setDialog("connect");
    return false;
  }, [backend]);

  const ask = useCallback(
    async (question: string, opts: AskOptions = {}): Promise<boolean> => {
      if (!question.trim() || !ensureKey()) return false;
      try {
        let t = treeRef.current;
        if (!t) {
          t = await backend.createTree({ model: modelRef.current.model, thinkingLevel: modelRef.current.thinking });
          treeRef.current = t;
          setTree(t);
          writePref("last-tree", t.id);
          writeRoute({ treeId: t.id });
        }
        const parentId = opts.parentId !== undefined ? opts.parentId : selectedRef.current;
        setQuote(null);
        void backend.ask(
          t.id,
          { parentId, question: question.trim(), quote: opts.quote, model: modelRef.current.model, thinkingLevel: modelRef.current.thinking },
          sinkFor(t.id, !opts.stay),
        );
        return true;
      } catch (err) {
        fail(err);
        return false;
      }
    },
    [backend, ensureKey, fail, sinkFor],
  );

  const park = useCallback(
    async (question: string, opts: Pick<AskOptions, "quote" | "parentId"> = {}): Promise<boolean> => {
      const t = treeRef.current;
      if (!question.trim() || !t) return false;
      try {
        const parentId = opts.parentId !== undefined ? opts.parentId : selectedRef.current;
        upsert(t.id, await backend.parkNode(t.id, { parentId, question: question.trim(), quote: opts.quote }));
        setQuote(null);
        void refreshTrees();
        return true;
      } catch (err) {
        fail(err);
        return false;
      }
    },
    [backend, fail, refreshTrees, upsert],
  );

  /** Ask a parked question, or regenerate an existing answer. */
  const runNode = useCallback(
    (nodeId: string) => {
      const t = treeRef.current;
      if (!t?.nodes[nodeId] || !ensureKey()) return;
      void backend.run(t.id, nodeId, { model: modelRef.current.model, thinkingLevel: modelRef.current.thinking }, sinkFor(t.id, false));
    },
    [backend, ensureKey, sinkFor],
  );

  const abort = useCallback(
    (nodeId: string) => {
      const t = treeRef.current;
      if (t) backend.abort(t.id, nodeId).catch(fail);
    },
    [backend, fail],
  );

  // ---------- node edits ----------
  const patchNode = useCallback(
    (nodeId: string, patch: NodePatch) => {
      const t = treeRef.current;
      if (!t?.nodes[nodeId]) return;
      setTree((cur) => (cur && cur.nodes[nodeId] ? { ...cur, nodes: { ...cur.nodes, [nodeId]: { ...cur.nodes[nodeId], ...patch } } } : cur));
      backend
        .updateNode(t.id, nodeId, patch)
        .then(() => void ("unread" in patch && refreshTrees())) // the sidebar counts unread answers per topic
        .catch(fail);
    },
    [backend, fail, refreshTrees],
  );

  const deleteNode = useCallback(
    async (nodeId: string) => {
      const t = treeRef.current;
      if (!t?.nodes[nodeId]) return;
      try {
        const parent = t.nodes[nodeId].parentId;
        const { deleted } = await backend.deleteNode(t.id, nodeId);
        const gone = new Set(deleted.map((n) => n.id));
        setTree((cur) => (cur ? { ...cur, nodes: Object.fromEntries(Object.entries(cur.nodes).filter(([id]) => !gone.has(id))) } : cur));
        const was = selectedRef.current;
        if (was && gone.has(was)) select(parent, "replace");
        void refreshTrees();
        toast(deleted.length === 1 ? "Deleted 1 node" : `Deleted ${deleted.length} nodes`, {
          action: {
            label: "Undo",
            run: async () => {
              try {
                await backend.restoreNodes(t.id, deleted);
                setTree((cur) => (cur && cur.id === t.id ? { ...cur, nodes: { ...cur.nodes, ...Object.fromEntries(deleted.map((n) => [n.id, n])) } } : cur));
                if (was && gone.has(was)) window.setTimeout(() => select(was, "replace"), 0);
                void refreshTrees();
              } catch (err) {
                fail(err);
              }
            },
          },
        });
      } catch (err) {
        fail(err);
      }
    },
    [backend, fail, refreshTrees, select, toast],
  );

  const suggest = useCallback(
    async (nodeId: string) => {
      const t = treeRef.current;
      if (!t || !ensureKey()) return;
      setSuggesting((s) => new Set(s).add(nodeId));
      try {
        const suggestions = await backend.suggest(t.id, nodeId, modelRef.current.model);
        setTree((cur) => (cur?.nodes[nodeId] ? { ...cur, nodes: { ...cur.nodes, [nodeId]: { ...cur.nodes[nodeId], suggestions } } } : cur));
      } catch (err) {
        fail(err);
      } finally {
        setSuggesting((s) => {
          const next = new Set(s);
          next.delete(nodeId);
          return next;
        });
      }
    },
    [backend, ensureKey, fail],
  );

  /** A suggestion that is asked or parked becomes a real node, so it leaves the suggestion list. */
  const takeSuggestion = useCallback(
    async (parentId: string, text: string, how: "ask" | "stay" | "park") => {
      const node = treeRef.current?.nodes[parentId];
      if (!node) return;
      const ok = how === "park" ? await park(text, { parentId }) : await ask(text, { parentId, stay: how === "stay" });
      if (ok) patchNode(parentId, { suggestions: (node.suggestions ?? []).filter((s) => s !== text) });
    },
    [ask, park, patchNode],
  );

  // ---------- topics ----------
  const renameTopic = useCallback(
    async (title: string) => {
      const t = treeRef.current;
      if (!t || !title.trim() || title.trim() === t.title) return;
      setTree({ ...t, title: title.trim() });
      await backend.updateTree(t.id, { title: title.trim() }).catch(fail);
      void refreshTrees();
    },
    [backend, fail, refreshTrees],
  );

  const deleteTopic = useCallback(
    async (id: string) => {
      try {
        const snapshot = await backend.getTree(id);
        await backend.deleteTree(id);
        if (treeRef.current?.id === id) newTopic();
        await refreshTrees();
        toast(`Deleted “${snapshot.title}”`, {
          action: {
            label: "Undo",
            run: async () => {
              try {
                const restored = await backend.importTree(snapshot);
                await refreshTrees();
                await openTree(restored.id);
              } catch (err) {
                fail(err);
              }
            },
          },
        });
      } catch (err) {
        fail(err);
      }
    },
    [backend, fail, newTopic, openTree, refreshTrees, toast],
  );

  const exportTopic = useCallback(
    (format: "md" | "json") => {
      const t = treeRef.current;
      if (!t) return;
      if (format === "md") download(`${slug(t.title)}.md`, toMarkdown(t), "text/markdown");
      else download(`${slug(t.title)}.tree.json`, JSON.stringify(t, null, 2));
    },
    [],
  );

  const exportAll = useCallback(async () => {
    try {
      const all = await Promise.all((await backend.listTrees()).map((s) => backend.getTree(s.id)));
      download(`tree-learn-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "tree-learn", version: 1, trees: all }, null, 2));
    } catch (err) {
      fail(err);
    }
  }, [backend, fail]);

  const importTrees = useCallback(
    async (input?: unknown) => {
      try {
        let data = input;
        if (data === undefined) {
          const file = await pickFile("application/json,.json");
          if (!file) return;
          data = JSON.parse(await file.text());
        }
        const list = isTree(data) ? [data] : Array.isArray((data as { trees?: unknown[] })?.trees) ? ((data as { trees: unknown[] }).trees.filter(isTree) as Tree[]) : [];
        if (!list.length) throw new Error("That file is not a Tree Learn export.");
        let last: Tree | undefined;
        for (const t of list) last = await backend.importTree(t);
        await refreshTrees();
        if (last) await openTree(last.id);
        if (list.length > 1) toast(`Imported ${list.length} topics`);
      } catch (err) {
        fail(err);
      }
    },
    [backend, fail, openTree, refreshTrees, toast],
  );

  // ---------- derived ----------
  const path = useMemo(() => (tree ? pathTo(tree, selectedId) : []), [tree, selectedId]);
  const pathIds = useMemo(() => new Set(path.map((n) => n.id)), [path]);
  const selected = selectedId && tree ? tree.nodes[selectedId] : undefined;
  const counts = useMemo(() => {
    const nodes = tree ? Object.values(tree.nodes) : [];
    return { total: nodes.length, unread: nodes.filter((n) => n.unread).length, parked: nodes.filter((n) => n.status === "parked").length };
  }, [tree]);

  const cycle = useCallback(
    (match: (n: TreeNode) => boolean) => {
      const t = treeRef.current;
      if (!t) return;
      const list = Object.values(t.nodes).filter(match).sort((a, b) => a.createdAt - b.createdAt);
      if (!list.length) return;
      const at = list.findIndex((n) => n.id === selectedRef.current);
      select(list[(at + 1) % list.length].id);
    },
    [select],
  );

  // Opening a finished answer marks it read.
  useEffect(() => {
    if (selected?.unread && selected.status !== "streaming") patchNode(selected.id, { unread: false });
  }, [selected?.id, selected?.unread, selected?.status, patchNode]);

  // ---------- sync with the world outside this tab ----------
  useEffect(() => {
    const id = tree?.id;
    if (!id) return;
    let stopped = false;
    const sync = async () => {
      const fresh = await backend.getTree(id).catch(() => null);
      if (!fresh || stopped || treeRef.current?.id !== id) return;
      setTree((cur) => {
        if (!cur || cur.id !== id) return cur;
        const nodes: Record<string, TreeNode> = {};
        for (const [nid, n] of Object.entries(fresh.nodes)) nodes[nid] = localStreaming.current.has(nid) && cur.nodes[nid] ? cur.nodes[nid] : n;
        for (const nid of localStreaming.current) if (cur.nodes[nid] && !nodes[nid]) nodes[nid] = cur.nodes[nid];
        const ids = Object.keys(nodes);
        const same =
          cur.title === fresh.title &&
          ids.length === Object.keys(cur.nodes).length &&
          ids.every((nid) => cur.nodes[nid] === nodes[nid] || JSON.stringify(cur.nodes[nid]) === JSON.stringify(nodes[nid]));
        return same ? cur : { ...cur, title: fresh.title, nodes };
      });
      void refreshTrees();
    };
    const unsubscribe = backend.subscribe(id, () => void sync());
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [backend, tree?.id, refreshTrees]);

  // The selected node can vanish (deleted in another tab): fall back to its nearest surviving ancestor.
  useEffect(() => {
    if (tree && selectedId && !tree.nodes[selectedId]) select(null, "replace");
  }, [tree, selectedId, select]);

  // Back / forward.
  useEffect(() => {
    const onPop = () => {
      const route = readRoute();
      const t = treeRef.current;
      if (!route.treeId) return newTopic();
      if (t?.id === route.treeId) {
        setSelectedId(route.nodeId && t.nodes[route.nodeId] ? route.nodeId : null);
        setQuote(null);
      } else void openTree(route.treeId, route.nodeId, "replace");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [newTopic, openTree]);

  // Boot.
  useEffect(() => {
    const vault = backend.vault;
    const off = vault?.onChange(() => setVaultTick((n) => n + 1));
    void (async () => {
      try {
        if (vault && (await vault.completeConnect()) === "connected") toast("OpenRouter connected. You are ready to ask.");
      } catch (err) {
        fail(err);
      }
      const [c, list] = await Promise.all([refreshCatalog(), backend.listTrees().catch(() => [] as TreeSummary[])]);
      catalogRef.current = c;
      setTrees(list);
      if (c) {
        setModelState((m) => m ?? c.defaultModel);
        setThinkingState((l) => l ?? c.defaultThinking);
      }
      const route = readRoute();
      const last = readPref<string | null>("last-tree", null);
      const open = [route.treeId, last, list[0]?.id].find((id) => id && list.some((t) => t.id === id));
      if (open) await openTree(open, open === route.treeId ? route.nodeId : undefined, "replace");
      setReady(true);
    })();
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    backend, ready, catalog, refreshCatalog, model, thinking, setModel,
    trees, tree, selectedId, selected, path, pathIds, counts, quote, setQuote,
    toasts, toast, dismissToast, dialog, setDialog, paletteOpen, setPaletteOpen, suggesting,
    select, openTree, newTopic, renameTopic, deleteTopic, exportTopic, exportAll, importTrees,
    ask, park, runNode, abort, patchNode, deleteNode, suggest, takeSuggestion, ensureKey,
    /** Stepping right on the keyboard follows the branch the learner used last. */
    preferredChild: (id: string) => {
      const kids = tree ? childrenOf(tree, id) : [];
      return kids.find((k) => k.id === lastChild.current.get(id)) ?? kids[0];
    },
    markAllRead: () => {
      for (const n of Object.values(treeRef.current?.nodes ?? {})) if (n.unread) patchNode(n.id, { unread: false });
      void refreshTrees();
    },
    nextUnread: () => cycle((n) => !!n.unread),
    nextParked: () => cycle((n) => n.status === "parked"),
    childrenOf: (id: string | null) => (tree ? childrenOf(tree, id) : []),
  };
}
