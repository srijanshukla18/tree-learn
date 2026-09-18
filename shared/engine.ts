import { SUGGEST_PROMPT, SYSTEM_PROMPT, buildMessages, cleanTitle, parseSuggestions, titlePrompt } from "./prompts.ts";
import { childrenOf, createTree, isTree, newId, pathTo, searchTrees, subtreeIds, summarize } from "./tree.ts";
import type {
  AskBody, EngineAPI, LLM, LLMRequest, ModelCatalog, NodePatch, SearchHit, StreamSink, Tree, TreeNode, TreePatch,
  TreeStorage, TreeSummary,
} from "./types.ts";

export const UNTITLED = "Untitled";
const SAVE_EVERY_MS = 1500;

export interface EngineOptions {
  storage: TreeStorage;
  llm: LLM;
  /** Fired after every persisted change (used to tell other tabs). */
  onChange?: (treeId: string) => void;
}

const clone = <T>(x: T): T => structuredClone(x);

/**
 * All behaviour of the notebook, independent of where trees are stored and who answers.
 * Local mode runs it in the server (files + pi); hosted mode runs it in the browser (IndexedDB + OpenRouter).
 */
export class Engine implements EngineAPI {
  private cache = new Map<string, Tree>();
  private inflight = new Map<string, AbortController>();
  private storage: TreeStorage;
  private llm: LLM;
  private onChange?: (treeId: string) => void;

  constructor(opts: EngineOptions) {
    this.storage = opts.storage;
    this.llm = opts.llm;
    this.onChange = opts.onChange;
  }

  models(): Promise<ModelCatalog> {
    return this.llm.catalog();
  }

  // ---------- trees ----------

  async listTrees(): Promise<TreeSummary[]> {
    const out: TreeSummary[] = [];
    for (const id of await this.storage.ids()) {
      const t = await this.load(id).catch(() => undefined);
      if (t) out.push(summarize(t));
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getTree(id: string): Promise<Tree> {
    return clone(await this.must(id));
  }

  async createTree(init: { title?: string; model?: string; thinkingLevel?: string }): Promise<Tree> {
    const tree = createTree(init.title?.trim() || UNTITLED, init.model, init.thinkingLevel);
    await this.save(tree);
    return clone(tree);
  }

  async updateTree(id: string, patch: TreePatch): Promise<Tree> {
    const tree = await this.must(id);
    if (typeof patch.title === "string" && patch.title.trim()) tree.title = patch.title.trim();
    if (typeof patch.model === "string") tree.model = patch.model;
    if (typeof patch.thinkingLevel === "string") tree.thinkingLevel = patch.thinkingLevel;
    await this.save(tree);
    return clone(tree);
  }

  async deleteTree(id: string): Promise<void> {
    const tree = await this.load(id);
    if (tree) for (const n of Object.keys(tree.nodes)) this.inflight.get(n)?.abort();
    this.cache.delete(id);
    await this.storage.remove(id);
    this.onChange?.(id);
  }

  async importTree(input: Tree): Promise<Tree> {
    if (!isTree(input)) throw new Error("That file is not a Tree Learn export.");
    const tree = clone(input);
    const taken = new Set(await this.storage.ids());
    if (!tree.id || !/^[a-zA-Z0-9_-]+$/.test(tree.id) || taken.has(tree.id)) tree.id = newId();
    tree.createdAt ||= Date.now();
    heal(tree, this.inflight);
    await this.save(tree);
    return clone(tree);
  }

  // ---------- nodes ----------

  async parkNode(treeId: string, body: Pick<AskBody, "parentId" | "question" | "quote">): Promise<TreeNode> {
    const tree = await this.must(treeId);
    const node = this.draft(tree, body, "parked", tree.model ?? "");
    tree.nodes[node.id] = node;
    await this.save(tree);
    return clone(node);
  }

  async updateNode(treeId: string, nodeId: string, patch: NodePatch): Promise<TreeNode> {
    const tree = await this.must(treeId);
    const node = mustNode(tree, nodeId);
    if (typeof patch.note === "string") node.note = patch.note;
    if (typeof patch.bookmarked === "boolean") node.bookmarked = patch.bookmarked;
    if (typeof patch.unread === "boolean") node.unread = patch.unread || undefined;
    if (typeof patch.collapsed === "boolean") node.collapsed = patch.collapsed || undefined;
    if (Array.isArray(patch.suggestions)) node.suggestions = patch.suggestions;
    if (typeof patch.question === "string" && patch.question.trim()) {
      node.question = patch.question.trim();
      node.updatedAt = Date.now();
    }
    await this.save(tree);
    return clone(node);
  }

  async deleteNode(treeId: string, nodeId: string): Promise<{ deleted: TreeNode[] }> {
    const tree = await this.must(treeId);
    const deleted: TreeNode[] = [];
    for (const id of subtreeIds(tree, nodeId)) {
      this.inflight.get(id)?.abort();
      deleted.push(clone(tree.nodes[id]));
      delete tree.nodes[id];
    }
    await this.save(tree);
    return { deleted };
  }

  async restoreNodes(treeId: string, nodes: TreeNode[]): Promise<void> {
    const tree = await this.must(treeId);
    for (const n of nodes) {
      if (!n?.id || typeof n.question !== "string") continue;
      const node = clone(n);
      if (node.status === "streaming") node.status = node.answer ? "done" : "parked";
      tree.nodes[node.id] = node;
    }
    await this.save(tree);
  }

  // ---------- asking ----------

  async ask(treeId: string, body: AskBody, sink: StreamSink): Promise<void> {
    const tree = await this.must(treeId);
    const model = body.model ?? tree.model ?? (await this.llm.catalog()).defaultModel;
    if (!model) throw new Error("No model available. Pick one in the model menu.");
    const thinkingLevel = body.thinkingLevel ?? tree.thinkingLevel;
    const node = this.draft(tree, body, "streaming", model, thinkingLevel);
    const firstRoot = !node.parentId && tree.title === UNTITLED && Object.keys(tree.nodes).length === 0;
    tree.nodes[node.id] = node;
    tree.model = model;
    if (thinkingLevel) tree.thinkingLevel = thinkingLevel;
    await this.save(tree);
    sink.onNode(clone(node));
    if (firstRoot) void this.autoTitle(tree, node, sink);
    await this.generate(tree.id, node, sink);
  }

  async run(treeId: string, nodeId: string, opts: { model?: string; thinkingLevel?: string }, sink: StreamSink): Promise<void> {
    const tree = await this.must(treeId);
    const node = mustNode(tree, nodeId);
    if (this.inflight.has(nodeId)) throw new Error("This answer is already being generated.");
    const model = opts.model ?? (node.model || undefined) ?? tree.model ?? (await this.llm.catalog()).defaultModel;
    if (!model) throw new Error("No model available. Pick one in the model menu.");
    Object.assign(node, {
      answer: "", thinking: undefined, thinkingMs: undefined, error: undefined, usage: undefined, suggestions: undefined,
      unread: undefined, status: "streaming", model, thinkingLevel: opts.thinkingLevel ?? node.thinkingLevel ?? tree.thinkingLevel,
    } satisfies Partial<TreeNode>);
    await this.save(tree);
    sink.onNode(clone(node));
    await this.generate(tree.id, node, sink);
  }

  async abort(_treeId: string, nodeId: string): Promise<void> {
    this.inflight.get(nodeId)?.abort();
  }

  async suggest(treeId: string, nodeId: string, modelArg?: string): Promise<string[]> {
    const tree = await this.must(treeId);
    const node = mustNode(tree, nodeId);
    const model = modelArg ?? tree.model ?? node.model;
    const messages = buildMessages(pathTo(tree, node.id));
    const asked = childrenOf(tree, node.id).map((c) => `- ${c.question}`);
    messages.push({ role: "user", content: SUGGEST_PROMPT + (asked.length ? `\n\nAlready asked from here:\n${asked.join("\n")}` : "") });
    const text = await this.complete({ model, thinkingLevel: "low", system: SYSTEM_PROMPT, messages });
    const taken = new Set(childrenOf(tree, node.id).map((c) => c.question.toLowerCase()));
    const suggestions = parseSuggestions(text).filter((s) => !taken.has(s.toLowerCase()));
    if (!suggestions.length) throw new Error("The model returned no usable suggestions. Try again or switch models.");
    node.suggestions = suggestions;
    await this.save(tree);
    return suggestions;
  }

  async search(query: string): Promise<SearchHit[]> {
    const trees: Tree[] = [];
    for (const id of await this.storage.ids()) {
      const t = await this.load(id).catch(() => undefined);
      if (t) trees.push(t);
    }
    return searchTrees(trees, query);
  }

  /** Another tab changed this tree: forget our copy, but keep the nodes we are still writing. */
  async invalidate(treeId: string): Promise<void> {
    const mine = this.cache.get(treeId);
    if (!mine) return;
    const live = Object.values(mine.nodes).filter((n) => this.inflight.has(n.id));
    this.cache.delete(treeId);
    if (!live.length) return;
    const fresh = await this.load(treeId);
    if (!fresh) return;
    for (const n of live) fresh.nodes[n.id] = n;
  }

  // ---------- internals ----------

  private draft(tree: Tree, body: Pick<AskBody, "parentId" | "question" | "quote">, status: TreeNode["status"], model: string, thinkingLevel?: string): TreeNode {
    const question = body.question?.trim();
    if (!question) throw new Error("A question is required.");
    if (body.parentId && !tree.nodes[body.parentId]) throw new Error("The node you are branching from no longer exists.");
    const now = Date.now();
    return {
      id: newId(), parentId: body.parentId ?? null, question, quote: body.quote?.trim() || undefined,
      answer: "", status, model, thinkingLevel, createdAt: now, updatedAt: now,
    };
  }

  private async generate(treeId: string, node: TreeNode, sink: StreamSink): Promise<void> {
    const ac = new AbortController();
    this.inflight.set(node.id, ac);
    const tree = this.cache.get(treeId)!;
    const messages = buildMessages(node.parentId ? pathTo(tree, node.parentId) : [], { question: node.question, quote: node.quote });
    const started = Date.now();
    let lastSave = started;
    try {
      const req: LLMRequest = { model: node.model, thinkingLevel: node.thinkingLevel, system: SYSTEM_PROMPT, messages, signal: ac.signal };
      for await (const ev of this.llm.stream(req)) {
        if (ev.type === "text") {
          if (!node.answer && node.thinking) node.thinkingMs = Date.now() - started;
          node.answer += ev.text;
          sink.onDelta(ev.text);
        } else if (ev.type === "thinking") {
          node.thinking = (node.thinking ?? "") + ev.text;
          sink.onThinking(ev.text);
        } else {
          node.usage = ev.usage;
        }
        if (Date.now() - lastSave > SAVE_EVERY_MS) {
          lastSave = Date.now();
          void this.persist(treeId);
        }
      }
      if (!node.answer.trim() && !ac.signal.aborted) throw new Error("The model returned an empty answer.");
      settle(node, ac.signal.aborted);
    } catch (err) {
      if (ac.signal.aborted) settle(node, true);
      else {
        node.status = "error";
        node.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.inflight.delete(node.id);
      node.updatedAt = Date.now();
      await this.persist(treeId);
    }
    if (node.status === "error") sink.onError(node.error ?? "Something went wrong.", clone(node));
    else sink.onDone(clone(node));
  }

  private async autoTitle(tree: Tree, node: TreeNode, sink: StreamSink) {
    try {
      const raw = await this.complete({ model: node.model, thinkingLevel: "off", messages: [{ role: "user", content: titlePrompt(node.question) }] });
      const title = cleanTitle(raw);
      const current = this.cache.get(tree.id);
      if (!title || !current || current.title !== UNTITLED) return;
      current.title = title;
      await this.save(current);
      sink.onTitle?.(title);
    } catch {
      /* a missing title is not worth surfacing */
    }
  }

  private async complete(req: LLMRequest): Promise<string> {
    let text = "";
    for await (const ev of this.llm.stream(req)) if (ev.type === "text") text += ev.text;
    return text;
  }

  private async load(id: string): Promise<Tree | undefined> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const tree = await this.storage.load(id);
    if (!tree) return undefined;
    const again = this.cache.get(id); // a concurrent load may have won
    if (again) return again;
    if (heal(tree, this.inflight)) void this.storage.save(tree);
    this.cache.set(id, tree);
    return tree;
  }

  private async must(id: string): Promise<Tree> {
    const tree = await this.load(id);
    if (!tree) throw new NotFoundError("That topic no longer exists.");
    return tree;
  }

  private async save(tree: Tree): Promise<void> {
    tree.updatedAt = Date.now();
    this.cache.set(tree.id, tree);
    await this.storage.save(tree);
    this.onChange?.(tree.id);
  }

  /** Save whatever the cache currently holds for this tree (the object may have been swapped by invalidate). */
  private async persist(treeId: string): Promise<void> {
    const tree = this.cache.get(treeId);
    if (tree) await this.save(tree);
  }
}

export class NotFoundError extends Error {}

function mustNode(tree: Tree, nodeId: string): TreeNode {
  const node = tree.nodes[nodeId];
  if (!node) throw new NotFoundError("That node no longer exists.");
  return node;
}

/** Final state after the stream ends. Stopping before any text arrived simply parks the question again. */
function settle(node: TreeNode, aborted: boolean) {
  if (node.answer.trim()) {
    node.status = "done";
    node.unread = true;
  } else if (aborted) {
    node.status = "parked";
    node.thinking = undefined;
    node.thinkingMs = undefined;
  }
}

/** A process or tab died mid-stream: nothing is writing these nodes any more. */
function heal(tree: Tree, inflight: Map<string, AbortController>): boolean {
  let changed = false;
  for (const n of Object.values(tree.nodes)) {
    if (n.status !== "streaming" || inflight.has(n.id)) continue;
    n.status = n.answer.trim() ? "done" : "parked";
    changed = true;
  }
  return changed;
}
