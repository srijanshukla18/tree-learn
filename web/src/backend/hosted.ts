import { Engine } from "@shared/engine";
import { authorizeUrl, createOpenRouterLLM, createPkcePair, exchangeCode, OPENROUTER_AUTH, OPENROUTER_BASE } from "@shared/openrouter";
import { createIdbStorage } from "./idb";
import type { Backend, KeyVault } from "./types";

const KEY = "tree-learn:openrouter-key";
const FAVORITES = "tree-learn:favorite-models";
const FAST_ROUTING = "tree-learn:fast-routing";
const VERIFIER = "tree-learn:pkce-verifier";
// Overridable so hosted mode can be developed against scripts/mock-openrouter.ts (or another compatible gateway).
const BASE = import.meta.env.VITE_OPENROUTER_BASE || OPENROUTER_BASE;
const AUTH = import.meta.env.VITE_OPENROUTER_AUTH || OPENROUTER_AUTH;

function createVault(): KeyVault {
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const read = () => localStorage.getItem(KEY) ?? undefined;
  return {
    hasKey: () => !!read(),
    hint: () => read()?.slice(-4),
    setKey(key) {
      localStorage.setItem(KEY, key.trim());
      emit();
    },
    clearKey() {
      localStorage.removeItem(KEY);
      emit();
    },
    async beginConnect() {
      const { verifier, challenge } = await createPkcePair();
      sessionStorage.setItem(VERIFIER, verifier);
      location.assign(authorizeUrl(location.origin + location.pathname, challenge, AUTH));
    },
    async completeConnect() {
      const url = new URL(location.href);
      const code = url.searchParams.get("code");
      const verifier = sessionStorage.getItem(VERIFIER);
      if (!code || !verifier) return "none";
      sessionStorage.removeItem(VERIFIER);
      url.searchParams.delete("code");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
      this.setKey(await exchangeCode(code, verifier, BASE));
      return "connected";
    },
    favorites: () => {
      try {
        return JSON.parse(localStorage.getItem(FAVORITES) ?? "[]") as string[];
      } catch {
        return [];
      }
    },
    toggleFavorite(id) {
      const set = new Set(this.favorites());
      if (!set.delete(id)) set.add(id);
      localStorage.setItem(FAVORITES, JSON.stringify([...set]));
      emit();
    },
    fastRouting: () => localStorage.getItem(FAST_ROUTING) !== "off",
    setFastRouting(on) {
      localStorage.setItem(FAST_ROUTING, on ? "on" : "off");
      emit();
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/**
 * Hosted mode has no server. The engine runs in this tab, topics live in IndexedDB,
 * and the only network destination is OpenRouter, called with the learner's own key.
 */
export function createHostedBackend(): Backend {
  const vault = createVault();
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("tree-learn") : undefined;
  const watchers = new Map<string, Set<() => void>>();

  const engine = new Engine({
    storage: createIdbStorage(),
    llm: createOpenRouterLLM({
      getKey: () => localStorage.getItem(KEY) ?? undefined,
      baseUrl: BASE,
      appUrl: location.origin,
      appTitle: "Tree Learn",
      favorites: () => vault.favorites(),
      fastRouting: () => vault.fastRouting(),
    }),
    onChange: (treeId) => channel?.postMessage({ treeId }),
  });

  // Another tab saved this tree: drop our stale copy, then let the UI refetch.
  channel?.addEventListener("message", (e: MessageEvent<{ treeId?: string }>) => {
    const id = e.data?.treeId;
    if (!id) return;
    void engine.invalidate(id).then(() => watchers.get(id)?.forEach((w) => w()));
  });

  const api = Object.fromEntries(
    (["models", "listTrees", "getTree", "createTree", "updateTree", "deleteTree", "importTree", "parkNode", "updateNode", "deleteNode", "restoreNodes", "ask", "run", "abort", "suggest", "search"] as const).map(
      (name) => [name, (engine[name] as (...a: unknown[]) => unknown).bind(engine)],
    ),
  ) as unknown as Omit<Backend, "kind" | "subscribe" | "vault">;

  return {
    ...api,
    kind: "hosted",
    vault,
    subscribe(treeId, onChange) {
      const set = watchers.get(treeId) ?? new Set();
      set.add(onChange);
      watchers.set(treeId, set);
      return () => set.delete(onChange);
    },
  };
}
