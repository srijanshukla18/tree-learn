/**
 * Marks, inside a rendered answer, the passages that branches were spawned from.
 * Uses the CSS Custom Highlight API: ranges are painted without touching React's DOM.
 */
const registry = new Map<string, Range[]>();
const supported = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

export function setQuoteRanges(owner: string, ranges: Range[]) {
  if (!supported) return;
  if (ranges.length) registry.set(owner, ranges);
  else registry.delete(owner);
  const all = [...registry.values()].flat();
  if (all.length) CSS.highlights.set("branch-quote", new Highlight(...all));
  else CSS.highlights.delete("branch-quote");
}

/**
 * Find `quote` in the text of `root`. Whitespace is ignored on both sides because a selection's
 * text and the DOM's text nodes disagree about line breaks between blocks, list items and table cells.
 */
export function findRange(root: HTMLElement, quote: string): Range | null {
  const needle = quote.replace(/\s+/g, "");
  if (needle.length < 2) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(".katex-mathml, .codeblock-head") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let hay = "";
  const map: { node: Text; offset: number }[] = [];
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const text = n.data;
    for (let i = 0; i < text.length; i++) {
      if (/\s/.test(text[i])) continue;
      hay += text[i];
      map.push({ node: n, offset: i });
    }
  }
  const at = hay.indexOf(needle);
  if (at < 0) return null;
  const start = map[at];
  const end = map[at + needle.length - 1];
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

export function rangeContainsPoint(range: Range, x: number, y: number) {
  for (const r of range.getClientRects()) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  return false;
}
