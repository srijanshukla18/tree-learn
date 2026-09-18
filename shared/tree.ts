import type { SearchHit, Tree, TreeNode, TreeSummary } from "./types.ts";

export function newId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export function createTree(title: string, model?: string, thinkingLevel?: string): Tree {
  const now = Date.now();
  return { id: newId(), title, createdAt: now, updatedAt: now, model, thinkingLevel, nodes: {} };
}

/** Root→node path, inclusive. */
export function pathTo(tree: Tree, nodeId: string | null | undefined): TreeNode[] {
  const out: TreeNode[] = [];
  const seen = new Set<string>();
  let cur = nodeId ? tree.nodes[nodeId] : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? tree.nodes[cur.parentId] : undefined;
  }
  return out;
}

export function childrenOf(tree: Tree, parentId: string | null): TreeNode[] {
  return Object.values(tree.nodes)
    .filter((n) => (n.parentId && tree.nodes[n.parentId] ? n.parentId : null) === parentId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The node and everything beneath it. */
export function subtreeIds(tree: Tree, nodeId: string): string[] {
  const kids = new Map<string, string[]>();
  for (const n of Object.values(tree.nodes)) {
    if (!n.parentId) continue;
    const arr = kids.get(n.parentId);
    if (arr) arr.push(n.id);
    else kids.set(n.parentId, [n.id]);
  }
  const out: string[] = [];
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    if (!tree.nodes[id]) continue;
    out.push(id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}

export function summarize(tree: Tree): TreeSummary {
  const nodes = Object.values(tree.nodes);
  return {
    id: tree.id,
    title: tree.title,
    createdAt: tree.createdAt,
    updatedAt: tree.updatedAt,
    nodeCount: nodes.length,
    unread: nodes.filter((n) => n.unread).length,
    parked: nodes.filter((n) => n.status === "parked").length,
    model: tree.model,
  };
}

function snippetAround(text: string, at: number, len: number) {
  const start = Math.max(0, at - 40);
  const end = Math.min(text.length, at + len + 80);
  const clean = text.slice(start, end).replace(/[*_`#>|~]|\$\$?/g, "").replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + clean + (end < text.length ? "…" : "");
}

const FIELD_RANK = { title: 0, question: 1, note: 2, answer: 3 } as const;

/** Case-insensitive substring search over titles, questions, notes and answers. All terms must match a field. */
export function searchTrees(trees: Tree[], query: string, limit = 40): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  const match = (text: string | undefined) => {
    if (!text) return -1;
    const lower = text.toLowerCase();
    let first = -1;
    for (const t of terms) {
      const i = lower.indexOf(t);
      if (i < 0) return -1;
      if (first < 0 || i < first) first = i;
    }
    return first;
  };
  for (const tree of trees) {
    const ti = match(tree.title);
    if (ti >= 0) hits.push({ treeId: tree.id, treeTitle: tree.title, field: "title", snippet: tree.title, updatedAt: tree.updatedAt });
    for (const n of Object.values(tree.nodes)) {
      for (const field of ["question", "note", "answer"] as const) {
        const text = n[field];
        const i = match(text);
        if (i < 0 || !text) continue;
        hits.push({
          treeId: tree.id,
          treeTitle: tree.title,
          nodeId: n.id,
          question: n.question,
          field,
          snippet: field === "question" ? n.question : snippetAround(text, i, terms[0].length),
          updatedAt: n.updatedAt,
        });
        break; // one hit per node, best field first
      }
    }
  }
  hits.sort((a, b) => FIELD_RANK[a.field] - FIELD_RANK[b.field] || b.updatedAt - a.updatedAt);
  return hits.slice(0, limit);
}

/** Depth-first Markdown outline of a whole tree. */
export function toMarkdown(tree: Tree): string {
  const lines: string[] = [`# ${tree.title}`, ""];
  const walk = (parentId: string | null, depth: number) => {
    for (const n of childrenOf(tree, parentId)) {
      const h = "#".repeat(Math.min(6, depth + 2));
      lines.push(`${h} ${n.question.replace(/\n+/g, " ")}`, "");
      if (n.quote) lines.push(...n.quote.trim().split("\n").map((l) => `> ${l}`), "");
      if (n.status === "parked") lines.push("_Parked: not asked yet._", "");
      else if (n.answer) lines.push(n.answer.trim(), "");
      if (n.note) lines.push(`> **Note:** ${n.note.trim().replace(/\n/g, "\n> ")}`, "");
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n");
}

/** Minimal shape check for imported JSON. */
export function isTree(x: unknown): x is Tree {
  if (!x || typeof x !== "object") return false;
  const t = x as Tree;
  if (typeof t.title !== "string" || !t.nodes || typeof t.nodes !== "object") return false;
  return Object.values(t.nodes).every((n) => n && typeof n.id === "string" && typeof n.question === "string" && typeof n.answer === "string");
}
