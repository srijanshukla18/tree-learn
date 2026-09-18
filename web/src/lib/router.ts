/** The URL hash names the open topic and node (#/t/<tree>/<node>) so back, forward and links work. */
export interface Route {
  treeId?: string;
  nodeId?: string;
}

export function readRoute(): Route {
  const m = location.hash.match(/^#\/t\/([\w-]+)(?:\/([\w-]+))?/);
  return m ? { treeId: m[1], nodeId: m[2] } : {};
}

export function writeRoute(route: Route, mode: "push" | "replace" = "push") {
  const hash = route.treeId ? `#/t/${route.treeId}${route.nodeId ? `/${route.nodeId}` : ""}` : "";
  if (hash === location.hash) return;
  const url = location.pathname + location.search + hash;
  if (mode === "replace") history.replaceState(null, "", url);
  else history.pushState(null, "", url);
}
