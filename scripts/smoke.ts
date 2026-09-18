/**
 * End-to-end smoke test of a running local server.
 *   npx tsx scripts/smoke.ts [baseUrl] [model]
 * Point it at a scratch data dir (TREE_LEARN_DATA=/tmp/x PORT=4748 npm run dev:api): it creates and deletes topics.
 */
import { createLocalBackend } from "../web/src/backend/local.ts";
import type { StreamSink, TreeNode } from "../shared/types.ts";

const base = process.argv[2] ?? "http://localhost:4748";
const model = process.argv[3];

// The local backend uses relative URLs; resolve them against the server under test.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  realFetch(typeof input === "string" && input.startsWith("/") ? base + input : input, init)) as typeof fetch;

const api = createLocalBackend();
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

function collect() {
  const seen = { node: undefined as TreeNode | undefined, deltas: 0, thinking: 0, done: undefined as TreeNode | undefined, error: "" , title: "" };
  const sink: StreamSink = {
    onNode: (n) => (seen.node = n),
    onDelta: () => seen.deltas++,
    onThinking: () => seen.thinking++,
    onTitle: (t) => (seen.title = t),
    onDone: (n) => (seen.done = n),
    onError: (m) => (seen.error = m),
  };
  return { seen, sink };
}

const catalog = await api.models();
check("catalog lists models", catalog.models.length > 0, `${catalog.models.length} models, default ${catalog.defaultModel}`);
const use = model ?? catalog.defaultModel!;

const tree = await api.createTree({});
const a = collect();
await api.ask(tree.id, { parentId: null, question: "In two sentences: what is a Merkle tree?", model: use, thinkingLevel: "off" }, a.sink);
check("ask streams an answer", !!a.seen.done && a.seen.deltas > 0 && !a.seen.error, a.seen.error || `${a.seen.deltas} deltas`);
check("finished answers start unread", a.seen.done?.unread === true);
const root = a.seen.done!;

const parked = await api.parkNode(tree.id, { parentId: root.id, question: "Where do blockchains use Merkle trees? One sentence." });
check("park creates an unanswered node", parked.status === "parked" && parked.answer === "");

const b = collect();
await api.run(tree.id, parked.id, { model: use, thinkingLevel: "off" }, b.sink);
check("running a parked node answers it", b.seen.done?.status === "done" && (b.seen.done?.answer.length ?? 0) > 0, b.seen.error);

await api.updateNode(tree.id, root.id, { unread: false, bookmarked: true, note: "remember this" });
const afterPatch = await api.getTree(tree.id);
check("patch clears unread, sets bookmark and note", !afterPatch.nodes[root.id].unread && afterPatch.nodes[root.id].bookmarked === true && afterPatch.nodes[root.id].note === "remember this");

const hits = await api.search("blockchains");
check("search finds the question", hits.some((h) => h.nodeId === parked.id));

const suggestions = await api.suggest(tree.id, root.id, use);
check("suggest returns follow-ups", suggestions.length >= 3, suggestions[0]);

const { deleted } = await api.deleteNode(tree.id, root.id);
check("delete removes the whole subtree", deleted.length === 2 && Object.keys((await api.getTree(tree.id)).nodes).length === 0);
await api.restoreNodes(tree.id, deleted);
check("restore brings it back (undo)", Object.keys((await api.getTree(tree.id)).nodes).length === 2);

const copy = await api.importTree(await api.getTree(tree.id));
check("import of an existing id becomes a new topic", copy.id !== tree.id && Object.keys(copy.nodes).length === 2);

// Stop before any text arrives: the question should simply be parked again.
const c = collect();
const pending = api.ask(tree.id, { parentId: root.id, question: "Write a 3000 word essay on hash functions.", model: use, thinkingLevel: "high" }, c.sink);
while (!c.seen.node) await new Promise((r) => setTimeout(r, 20));
await api.abort(tree.id, c.seen.node.id);
await pending;
const stopped = (await api.getTree(tree.id)).nodes[c.seen.node.id];
check("stopping early parks (or keeps the partial answer)", stopped.status === "parked" || (stopped.status === "done" && stopped.answer.length > 0), `status=${stopped.status}`);

const titled = (await api.listTrees()).find((t) => t.id === tree.id);
check("topic was auto-titled", !!titled && titled.title !== "Untitled", titled?.title);
check("summary counts parked/unread", typeof titled?.parked === "number" && typeof titled?.unread === "number", `parked=${titled?.parked} unread=${titled?.unread}`);

await api.deleteTree(tree.id);
await api.deleteTree(copy.id);
check("topics deleted", !(await api.listTrees()).some((t) => t.id === tree.id || t.id === copy.id));

console.log(failures ? `\n${failures} check(s) failed` : "\nall good");
process.exit(failures ? 1 : 0);
