import type { AskBody, ModelCatalog, NodePatch, SearchHit, StreamSink, Tree, TreeNode, TreePatch, TreeSummary } from "@shared/types";
import type { Backend } from "./types";

async function http<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  }).catch(() => {
    throw new Error("Cannot reach the Tree Learn server. Is `npm run dev` still running?");
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json() as Promise<T>;
}

async function errorText(res: Response) {
  try {
    return ((await res.json()) as { error?: string }).error ?? res.statusText;
  } catch {
    return res.status === 502 || res.status === 504 ? "Cannot reach the Tree Learn server. Is `npm run dev` still running?" : res.statusText;
  }
}

/** Read a POST response as server-sent events and feed the sink. */
async function sse(path: string, json: unknown, sink: StreamSink): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
  } catch {
    return sink.onError("Cannot reach the Tree Learn server. Is `npm run dev` still running?");
  }
  if (!res.ok || !res.body) return sink.onError(await errorText(res));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  const dispatch = (event: string, data: string) => {
    const p = JSON.parse(data) as { text?: string; title?: string; message?: string; node?: TreeNode } & TreeNode;
    if (event === "node") sink.onNode(p);
    else if (event === "delta") sink.onDelta(p.text ?? "");
    else if (event === "thinking") sink.onThinking(p.text ?? "");
    else if (event === "title") sink.onTitle?.(p.title ?? "");
    else if (event === "done") (finished = true), sink.onDone(p.node as TreeNode);
    else if (event === "error") (finished = true), sink.onError(p.message ?? "Something went wrong.", p.node);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length) dispatch(event, data.join("\n"));
      }
    }
  } catch {
    /* connection dropped: handled below */
  }
  // The server keeps generating even if we lose the stream; the periodic sync will pick the answer up.
  if (!finished) sink.onError("Lost the connection to the server. The answer will appear when it finishes.");
}

export function createLocalBackend(): Backend {
  const t = (id: string) => `/api/trees/${id}`;
  return {
    kind: "local",
    models: () => http<ModelCatalog>("/api/models"),
    listTrees: () => http<TreeSummary[]>("/api/trees"),
    getTree: (id) => http<Tree>(t(id)),
    createTree: (init) => http<Tree>("/api/trees", { method: "POST", json: init }),
    updateTree: (id, patch: TreePatch) => http<Tree>(t(id), { method: "PATCH", json: patch }),
    deleteTree: async (id) => void (await http(t(id), { method: "DELETE" })),
    importTree: (tree) => http<Tree>("/api/trees/import", { method: "POST", json: tree }),
    parkNode: (id, body) => http<TreeNode>(`${t(id)}/nodes`, { method: "POST", json: body }),
    updateNode: (id, nodeId, patch: NodePatch) => http<TreeNode>(`${t(id)}/nodes/${nodeId}`, { method: "PATCH", json: patch }),
    deleteNode: (id, nodeId) => http<{ deleted: TreeNode[] }>(`${t(id)}/nodes/${nodeId}`, { method: "DELETE" }),
    restoreNodes: async (id, nodes) => void (await http(`${t(id)}/restore`, { method: "POST", json: { nodes } })),
    ask: (id, body: AskBody, sink) => sse(`${t(id)}/ask`, body, sink),
    run: (id, nodeId, opts, sink) => sse(`${t(id)}/nodes/${nodeId}/run`, opts, sink),
    abort: async (id, nodeId) => void (await http(`${t(id)}/nodes/${nodeId}/abort`, { method: "POST", json: {} })),
    suggest: async (id, nodeId, model) => (await http<{ suggestions: string[] }>(`${t(id)}/nodes/${nodeId}/suggest`, { method: "POST", json: { model } })).suggestions,
    search: (q) => http<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),

    // Other tabs and background generations change trees on the server; poll gently and on focus.
    subscribe(_treeId, onChange) {
      const tick = () => !document.hidden && onChange();
      const timer = window.setInterval(tick, 5000);
      document.addEventListener("visibilitychange", tick);
      window.addEventListener("focus", tick);
      return () => {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", tick);
        window.removeEventListener("focus", tick);
      };
    },
  };
}
