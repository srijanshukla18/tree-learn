/**
 * Models write math in several dialects. The renderer understands $…$ and $$…$$ only, so:
 *   \( … \)  →  $…$        \[ … \]  →  $$…$$
 * and a dollar sign that is clearly money ("$5", "$0.15/M") is escaped so it cannot open a formula.
 * Code spans and fenced blocks are left untouched.
 */
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;
const MONEY = /(?<![\\$\w])\$(?=\d[\d,]*(?:\.\d+)?(?:\s|$|[.,;:!?)\]/]|[kKmMbB]\b))/g;

export function normalizeMath(markdown: string): string {
  if (!/[\\$]/.test(markdown)) return markdown;
  return markdown
    .split(CODE)
    .map((part, i) => {
      if (i % 2) return part; // a code span or block
      return part
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `\n$$\n${body.trim()}\n$$\n`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => `$${body.trim()}$`)
        .replace(MONEY, "\\$");
    })
    .join("");
}
