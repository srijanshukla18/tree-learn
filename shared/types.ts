/** A node is one exchange: the learner's question and the model's answer. */
export type NodeStatus = "parked" | "streaming" | "done" | "error";

export interface TreeNode {
  id: string;
  parentId: string | null;
  question: string;
  /** Excerpt of the parent's answer this branch was spawned from. */
  quote?: string;
  /** Markdown answer. Empty while parked. */
  answer: string;
  /** Model reasoning, when the provider streams it. */
  thinking?: string;
  /** How long the model reasoned before the first answer token. */
  thinkingMs?: number;
  status: NodeStatus;
  error?: string;
  /** "provider/modelId" in local mode, OpenRouter model id in hosted mode. */
  model: string;
  thinkingLevel?: string;
  createdAt: number;
  updatedAt: number;
  usage?: { input: number; output: number; cost: number };
  /** Model-suggested follow-ups ("rabbit holes"). */
  suggestions?: string[];
  bookmarked?: boolean;
  note?: string;
  /** Finished while the learner was elsewhere and has not been opened since. */
  unread?: boolean;
  /** Subtree folded on the canvas. */
  collapsed?: boolean;
}

export interface Tree {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model?: string;
  thinkingLevel?: string;
  nodes: Record<string, TreeNode>;
}

export interface TreeSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  unread: number;
  parked: number;
  model?: string;
}

export interface ModelInfo {
  id: string;
  provider: string;
  modelId: string;
  name: string;
  reasoning: boolean;
  thinkingLevels: string[];
  contextWindow: number;
  /** USD per million tokens. */
  cost: { input: number; output: number };
  /** Shown in the top group of the picker. */
  enabled: boolean;
}

export interface ModelCatalog {
  models: ModelInfo[];
  defaultModel?: string;
  defaultThinking?: string;
}

export interface SearchHit {
  treeId: string;
  treeTitle: string;
  nodeId?: string;
  question?: string;
  field: "title" | "question" | "answer" | "note";
  snippet: string;
  updatedAt: number;
}

export type NodePatch = Partial<Pick<TreeNode, "note" | "bookmarked" | "question" | "suggestions" | "unread" | "collapsed">>;
export type TreePatch = Partial<Pick<Tree, "title" | "model" | "thinkingLevel">>;

export interface AskBody {
  parentId: string | null;
  question: string;
  quote?: string;
  model?: string;
  thinkingLevel?: string;
}

/** Receives the life of one streamed answer. */
export interface StreamSink {
  onNode(node: TreeNode): void;
  onDelta(text: string): void;
  onThinking(text: string): void;
  onTitle?(title: string): void;
  onDone(node: TreeNode): void;
  onError(message: string, node?: TreeNode): void;
}

/** What the UI needs from a backend; implemented by the engine itself (hosted) and by an HTTP client (local). */
export interface EngineAPI {
  models(): Promise<ModelCatalog>;
  listTrees(): Promise<TreeSummary[]>;
  getTree(id: string): Promise<Tree>;
  createTree(init: { title?: string; model?: string; thinkingLevel?: string }): Promise<Tree>;
  updateTree(id: string, patch: TreePatch): Promise<Tree>;
  deleteTree(id: string): Promise<void>;
  importTree(tree: Tree): Promise<Tree>;
  parkNode(treeId: string, body: Pick<AskBody, "parentId" | "question" | "quote">): Promise<TreeNode>;
  updateNode(treeId: string, nodeId: string, patch: NodePatch): Promise<TreeNode>;
  deleteNode(treeId: string, nodeId: string): Promise<{ deleted: TreeNode[] }>;
  restoreNodes(treeId: string, nodes: TreeNode[]): Promise<void>;
  ask(treeId: string, body: AskBody, sink: StreamSink): Promise<void>;
  /** Generate (or regenerate) the answer of an existing node: un-parks a parked node. */
  run(treeId: string, nodeId: string, opts: { model?: string; thinkingLevel?: string }, sink: StreamSink): Promise<void>;
  abort(treeId: string, nodeId: string): Promise<void>;
  suggest(treeId: string, nodeId: string, model?: string): Promise<string[]>;
  search(query: string): Promise<SearchHit[]>;
}

/** Where trees live. */
export interface TreeStorage {
  ids(): Promise<string[]>;
  load(id: string): Promise<Tree | undefined>;
  save(tree: Tree): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type LLMEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "usage"; usage: { input: number; output: number; cost: number } };

export interface LLMRequest {
  model: string;
  thinkingLevel?: string;
  system?: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

/** Who answers. Errors are thrown; an aborted signal ends the stream quietly. */
export interface LLM {
  catalog(): Promise<ModelCatalog>;
  stream(req: LLMRequest): AsyncIterable<LLMEvent>;
}
