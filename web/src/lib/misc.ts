export function timeAgo(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function shortModel(id: string) {
  const last = id.split("/").pop() ?? id;
  return last.replace(/^~/, "");
}

export function formatCost(cost?: number) {
  // Some routers report a negative placeholder rather than a real cost; showing "-$225" helps nobody.
  if (!cost || cost < 0) return "";
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

export function formatDuration(ms?: number) {
  if (!ms) return "";
  const s = ms / 1000;
  return s < 60 ? `${s < 10 ? s.toFixed(1) : Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** Strip Markdown syntax for one-line previews. */
export function plain(md: string, max = 260) {
  return md
    .slice(0, max * 2)
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/\$\$?([^$]*)\$\$?/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[#>\-*+\s|]+/gm, "")
    .replace(/[*_`~|\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function download(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "topic";
}

export function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0]);
    input.click();
  });
}
