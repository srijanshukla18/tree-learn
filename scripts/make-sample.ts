/**
 * Regenerates web/src/sample-tree.json (the "Explore a sample tree" demo) by asking a real model through a running
 * local server. Point it at a scratch data dir:  TREE_LEARN_DATA=/tmp/x PORT=4748 npm run dev:api
 *   npx tsx scripts/make-sample.ts http://localhost:4748 [model]
 */
import { writeFileSync } from "node:fs";
import { createLocalBackend } from "../web/src/backend/local.ts";
import type { StreamSink, TreeNode } from "../shared/types.ts";

const base = process.argv[2] ?? "http://localhost:4748";
const model = process.argv[3];
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => realFetch(typeof input === "string" && input.startsWith("/") ? base + input : input, init)) as typeof fetch;
const api = createLocalBackend();

const tree = await api.createTree({ title: "Why the sky is blue" });
const ask = (parentId: string | null, question: string, quote?: string) =>
  new Promise<TreeNode>((resolve, reject) => {
    const sink: StreamSink = { onNode() {}, onDelta() {}, onThinking() {}, onDone: resolve, onError: (m) => reject(new Error(m)) };
    void api.ask(tree.id, { parentId, question, quote, model, thinkingLevel: "low" }, sink);
  });
const firstBoldTerm = (answer: string, avoid: RegExp) => [...answer.matchAll(/\*\*([^*\n]{4,40})\*\*/g)].map((m) => m[1]).find((t) => !avoid.test(t));

console.log("root…");
const root = await ask(null, "Why is the sky blue?");
const term = firstBoldTerm(root.answer, /^$/) ?? "scattering";
console.log("branches…", { term });
const [explain, violet, sunset] = await Promise.all([
  ask(root.id, `Explain “${term}”`, term),
  ask(root.id, "If violet light scatters even more than blue, why isn't the sky violet?"),
  ask(root.id, "Why are sunsets red, then?"),
]);
const deeper = await ask(explain.id, "Why does the effect depend so strongly on wavelength?");
const eyeTerm = firstBoldTerm(violet.answer, /violet|blue/i);
if (eyeTerm) await ask(violet.id, `Explain “${eyeTerm}”`, eyeTerm);

await api.parkNode(tree.id, { parentId: root.id, question: "What colour is the sky on Mars, and why?" });
await api.parkNode(tree.id, { parentId: sunset.id, question: "Why does the Moon turn red during a lunar eclipse?" });
await api.parkNode(tree.id, { parentId: explain.id, question: "Does the same scattering happen in water or glass?" });
await api.suggest(tree.id, deeper.id, model).catch(() => {});

await api.updateNode(tree.id, violet.id, { bookmarked: true, note: "The answer is partly about eyes, not just physics. Worth re-reading." });

const out = await api.getTree(tree.id);
for (const n of Object.values(out.nodes)) {
  n.unread = n.id === sunset.id ? true : undefined;
  if (n.thinking && n.thinking.length > 500) n.thinking = n.thinking.slice(0, 500).trimEnd() + "…";
}
out.id = "sample";
delete out.model;
delete out.thinkingLevel;
writeFileSync(new URL("../web/src/sample-tree.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
await api.deleteTree(tree.id);
console.log(`wrote web/src/sample-tree.json with ${Object.keys(out.nodes).length} nodes`);
process.exit(0);
