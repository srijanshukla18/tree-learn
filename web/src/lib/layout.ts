import { hierarchy, tree as tidyTree } from "d3-hierarchy";
import type { Tree, TreeNode } from "@shared/types";

export const NODE_W = 256;
export const NODE_H = 110;
const GAP_X = 76;
const GAP_Y = 20;

export interface Ghost {
  parentId: string;
  text: string;
  index: number;
}
export interface Placed {
  id: string;
  x: number;
  y: number;
  depth: number;
  parentId: string | null;
  node?: TreeNode;
  ghost?: Ghost;
  /** Descendants hidden because this node is folded. */
  hidden: number;
  kids: number;
}
export interface Link {
  id: string;
  from: Placed;
  to: Placed;
}
export interface Layout {
  nodes: Placed[];
  links: Link[];
  byId: Map<string, Placed>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

interface Item {
  id: string;
  node?: TreeNode;
  ghost?: Ghost;
}

/** Everything that changes the picture's shape; text streaming into a node does not. */
export function shapeKey(tree: Tree, ghosts?: { parentId: string; suggestions: string[] }) {
  const nodes = Object.values(tree.nodes).map((n) => `${n.id}:${n.parentId ?? ""}:${n.collapsed ? 1 : 0}:${n.createdAt}`);
  return nodes.sort().join("|") + (ghosts ? `#${ghosts.parentId}:${ghosts.suggestions.join("¦")}` : "");
}

export function computeLayout(tree: Tree, ghosts?: { parentId: string; suggestions: string[] }): Layout {
  const kids = new Map<string | null, TreeNode[]>();
  for (const n of Object.values(tree.nodes)) {
    const parent = n.parentId && tree.nodes[n.parentId] ? n.parentId : null;
    const list = kids.get(parent);
    if (list) list.push(n);
    else kids.set(parent, [n]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.createdAt - b.createdAt);

  const countBelow = (id: string): number => (kids.get(id) ?? []).reduce((sum, k) => sum + 1 + countBelow(k.id), 0);

  const childrenOf = (item: Item): Item[] => {
    if (item.ghost) return [];
    const id = item.node?.id ?? null;
    if (item.node?.collapsed) return [];
    const real: Item[] = (kids.get(id) ?? []).map((node) => ({ id: node.id, node }));
    if (ghosts && id === ghosts.parentId) {
      ghosts.suggestions.forEach((text, index) => real.push({ id: `ghost:${id}:${index}`, ghost: { parentId: id, text, index } }));
    }
    return real;
  };

  const root = tidyTree<Item>()
    .nodeSize([NODE_H + GAP_Y, NODE_W + GAP_X])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.18))(hierarchy<Item>({ id: "__root__" }, childrenOf));

  const nodes: Placed[] = [];
  const byId = new Map<string, Placed>();
  root.each((d) => {
    if (d.depth === 0) return;
    const parent = d.parent && d.parent.depth > 0 ? d.parent.data.id : null;
    const placed: Placed = {
      id: d.data.id,
      x: (d.depth - 1) * (NODE_W + GAP_X),
      y: d.x,
      depth: d.depth - 1,
      parentId: parent,
      node: d.data.node,
      ghost: d.data.ghost,
      hidden: d.data.node?.collapsed ? countBelow(d.data.id) : 0,
      kids: d.data.node ? (kids.get(d.data.id) ?? []).length : 0,
    };
    nodes.push(placed);
    byId.set(placed.id, placed);
  });

  const links: Link[] = [];
  for (const n of nodes) {
    const from = n.parentId ? byId.get(n.parentId) : undefined;
    if (from) links.push({ id: `${from.id}>${n.id}`, from, to: n });
  }

  const bounds = nodes.reduce(
    (b, n) => ({ minX: Math.min(b.minX, n.x), minY: Math.min(b.minY, n.y), maxX: Math.max(b.maxX, n.x + NODE_W), maxY: Math.max(b.maxY, n.y + NODE_H) }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  if (!nodes.length) Object.assign(bounds, { minX: 0, minY: 0, maxX: NODE_W, maxY: NODE_H });
  return { nodes, links, byId, bounds };
}

export function linkPath(l: Link) {
  const x1 = l.from.x + NODE_W;
  const y1 = l.from.y + NODE_H / 2;
  const x2 = l.to.x;
  const y2 = l.to.y + NODE_H / 2;
  const c = (x2 - x1) * 0.55;
  return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
}
