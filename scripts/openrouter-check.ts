/**
 * Runs the hosted-mode engine (OpenRouter adapter + in-memory storage) against the real OpenRouter API.
 *   OPENROUTER_API_KEY=sk-or-... npx tsx scripts/openrouter-check.ts [model]
 * With no env key it borrows the one configured in pi, if any. The key is never printed.
 */
import { Engine } from "../shared/engine.ts";
import { createOpenRouterLLM } from "../shared/openrouter.ts";
import type { StreamSink, Tree, TreeNode, TreeStorage } from "../shared/types.ts";

async function findKey(): Promise<string | undefined> {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const auth = await (await ModelRuntime.create({ refreshOnCreate: false })).getAuth("openrouter");
    return (auth as { auth?: { apiKey?: string } } | undefined)?.auth?.apiKey;
  } catch {
    return undefined;
  }
}

const memory = new Map<string, Tree>();
const storage: TreeStorage = {
  ids: async () => [...memory.keys()],
  load: async (id) => structuredClone(memory.get(id)),
  save: async (t) => void memory.set(t.id, structuredClone(t)),
  remove: async (id) => void memory.delete(id),
};

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const sinkFor = () => {
  const seen = { deltas: 0, thinking: 0, done: undefined as TreeNode | undefined, error: "", title: "" };
  const sink: StreamSink = { onNode() {}, onDelta: () => seen.deltas++, onThinking: () => seen.thinking++, onTitle: (t) => (seen.title = t), onDone: (n) => (seen.done = n), onError: (m) => (seen.error = m) };
  return { seen, sink };
};

const key = await findKey();
if (!key) {
  console.log("No OpenRouter key found (set OPENROUTER_API_KEY). Skipping.");
  process.exit(0);
}

let currentKey: string | undefined = key;
const engine = new Engine({ storage, llm: createOpenRouterLLM({ getKey: () => currentKey, appTitle: "Tree Learn (check)" }) });

const catalog = await engine.models();
const model = process.argv[2] ?? catalog.defaultModel!;
check("catalog loads without a key-dependent call", catalog.models.length > 50, `${catalog.models.length} models`);
check("default is a '-latest' alias", !!catalog.defaultModel?.startsWith("~"), catalog.defaultModel);
check("batch variants are hidden", !catalog.models.some((m) => m.id.endsWith(":batch")));
const picked = catalog.models.find((m) => m.id === model);
check("prices are per million tokens", !!picked && picked.cost.input > 0 && picked.cost.input < 100, picked && `$${picked.cost.input}/${picked.cost.output}`);

const tree = await engine.createTree({});
const a = sinkFor();
await engine.ask(tree.id, { parentId: null, question: "In one sentence, what is a trie?", model, thinkingLevel: "low" }, a.sink);
check("streams text", a.seen.deltas > 0 && !!a.seen.done, a.seen.error || `${a.seen.deltas} deltas`);
check("streams reasoning at effort=low", a.seen.thinking > 0, `${a.seen.thinking} reasoning deltas`);
check("reports usage and cost", (a.seen.done?.usage?.output ?? 0) > 0 && (a.seen.done?.usage?.cost ?? 0) > 0, JSON.stringify(a.seen.done?.usage));

const b = sinkFor();
await engine.ask(tree.id, { parentId: a.seen.done!.id, question: "And a radix tree, in one sentence?", model, thinkingLevel: "off" }, b.sink);
check("follow-up carries context; effort=none accepted", !!b.seen.done && /trie|radix|prefix/i.test(b.seen.done.answer), b.seen.error || b.seen.done?.answer.slice(0, 80));

const s = await engine.suggest(tree.id, a.seen.done!.id, model);
check("suggestions parse", s.length >= 3, s[0]);

await new Promise((r) => setTimeout(r, 1500));
check("auto-title", (await engine.getTree(tree.id)).title !== "Untitled", (await engine.getTree(tree.id)).title);

const bad = sinkFor();
currentKey = "sk-or-v1-definitely-not-a-real-key";
await engine.ask(tree.id, { parentId: null, question: "hi", model }, bad.sink);
check("bad key gives a human message", /rejected the API key/i.test(bad.seen.error), bad.seen.error);

const none = sinkFor();
currentKey = undefined;
await engine.ask(tree.id, { parentId: null, question: "hi", model }, none.sink);
check("missing key gives a human message", /Connect your OpenRouter/i.test(none.seen.error), none.seen.error);

console.log(failures ? `\n${failures} check(s) failed` : "\nall good");
process.exit(failures ? 1 : 0);
