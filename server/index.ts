import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Engine, NotFoundError } from "../shared/engine.ts";
import type { AskBody, NodePatch, StreamSink, Tree, TreeNode, TreePatch } from "../shared/types.ts";
import { createFsStorage } from "./fs-storage.ts";
import { createPiLLM } from "./pi-llm.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.TREE_LEARN_DATA ?? path.resolve(here, "..", "data");
const engine = new Engine({ storage: createFsStorage(dataDir), llm: createPiLLM() });

const app = new Hono();

app.onError((err, c) => {
  if (!(err instanceof NotFoundError)) console.error(err);
  return c.json({ error: err.message || String(err) }, err instanceof NotFoundError ? 404 : 500);
});

const body = async <T>(c: Context): Promise<T> => ((await c.req.json().catch(() => ({}))) as T);

/**
 * This server can spend the owner's LLM credentials, so it only talks to pages served from this machine.
 * The Host check defeats DNS rebinding; the Origin check stops other websites from posting to localhost.
 * Add names with TREE_LEARN_ALLOWED_HOSTS=my-mac.local,100.64.0.7 to reach it from another device.
 */
const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]", ...(process.env.TREE_LEARN_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean)]);
const hostname = (value: string) => value.replace(/^https?:\/\//, "").replace(/:\d+$/, "").toLowerCase();
app.use("/api/*", async (c, next) => {
  const origin = c.req.header("origin");
  if (!allowedHosts.has(hostname(c.req.header("host") ?? "")) || (origin && !allowedHosts.has(hostname(origin)))) {
    return c.json({ error: "This Tree Learn server only accepts requests from this machine." }, 403);
  }
  await next();
});

app.get("/api/health", (c) => c.json({ ok: true, app: "tree-learn", dataDir }));
app.get("/api/models", async (c) => c.json(await engine.models()));
app.get("/api/search", async (c) => c.json(await engine.search(c.req.query("q") ?? "")));

app.get("/api/trees", async (c) => c.json(await engine.listTrees()));
app.post("/api/trees", async (c) => c.json(await engine.createTree(await body(c)), 201));
app.post("/api/trees/import", async (c) => c.json(await engine.importTree(await body<Tree>(c)), 201));
app.get("/api/trees/:id", async (c) => c.json(await engine.getTree(c.req.param("id"))));
app.patch("/api/trees/:id", async (c) => c.json(await engine.updateTree(c.req.param("id"), await body<TreePatch>(c))));
app.delete("/api/trees/:id", async (c) => {
  await engine.deleteTree(c.req.param("id"));
  return c.json({ ok: true });
});

app.post("/api/trees/:id/nodes", async (c) => c.json(await engine.parkNode(c.req.param("id"), await body(c)), 201));
app.post("/api/trees/:id/restore", async (c) => {
  await engine.restoreNodes(c.req.param("id"), (await body<{ nodes: TreeNode[] }>(c)).nodes ?? []);
  return c.json({ ok: true });
});
app.patch("/api/trees/:id/nodes/:nodeId", async (c) =>
  c.json(await engine.updateNode(c.req.param("id"), c.req.param("nodeId"), await body<NodePatch>(c))),
);
app.delete("/api/trees/:id/nodes/:nodeId", async (c) => c.json(await engine.deleteNode(c.req.param("id"), c.req.param("nodeId"))));
app.post("/api/trees/:id/nodes/:nodeId/abort", async (c) => {
  await engine.abort(c.req.param("id"), c.req.param("nodeId"));
  return c.json({ ok: true });
});
app.post("/api/trees/:id/nodes/:nodeId/suggest", async (c) => {
  const { model } = await body<{ model?: string }>(c);
  return c.json({ suggestions: await engine.suggest(c.req.param("id"), c.req.param("nodeId"), model) });
});

/**
 * Streaming endpoints speak SSE: node → (thinking | delta | title)* → done | error.
 * Generation belongs to the engine, not the connection: if the tab closes, the answer still finishes and is saved.
 */
function stream(c: Context, start: (sink: StreamSink) => Promise<void>) {
  return streamSSE(c, async (sse) => {
    let open = true;
    sse.onAbort(() => void (open = false));
    const send = (event: string, data: unknown) => {
      if (open) sse.writeSSE({ event, data: JSON.stringify(data) }).catch(() => (open = false));
    };
    await start({
      onNode: (node) => send("node", node),
      onDelta: (text) => send("delta", { text }),
      onThinking: (text) => send("thinking", { text }),
      onTitle: (title) => send("title", { title }),
      onDone: (node) => send("done", { node }),
      onError: (message, node) => send("error", { message, node }),
    }).catch((err: Error) => send("error", { message: err.message }));
    await sse.sleep(0); // let the last event flush before the stream closes
  });
}

app.post("/api/trees/:id/ask", async (c) => {
  const ask = await body<AskBody>(c);
  return stream(c, (sink) => engine.ask(c.req.param("id"), ask, sink));
});
app.post("/api/trees/:id/nodes/:nodeId/run", async (c) => {
  const opts = await body<{ model?: string; thinkingLevel?: string }>(c);
  return stream(c, (sink) => engine.run(c.req.param("id"), c.req.param("nodeId"), opts, sink));
});

// When built (`npm run build`), the same server also serves the UI.
const dist = path.relative(process.cwd(), path.resolve(here, "..", "web", "dist")) || ".";
app.use("/*", serveStatic({ root: dist }));
app.get("*", serveStatic({ path: path.join(dist, "index.html") }));

const port = Number(process.env.PORT ?? 4747);
const bind = process.env.HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, port, hostname: bind }, () => console.log(`tree-learn api → http://localhost:${port}  (data: ${dataDir})`));
