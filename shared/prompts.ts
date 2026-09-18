import type { ChatMessage, TreeNode } from "./types.ts";

export const SYSTEM_PROMPT = `You are a patient, precise tutor inside a tree-structured learning notebook.
The learner explores a topic by branching: each question you see may be a follow-up to an earlier answer,
sometimes anchored on a quoted excerpt of that answer (shown as a blockquote). Treat the quote as the focus.

Guidelines:
- Answer directly and concretely. Prefer depth over breadth; the learner branches for breadth.
- Use Markdown. Use headings sparingly, short paragraphs, lists for parallel items, tables for comparisons.
- Use $...$ / $$...$$ LaTeX for math when it helps.
- Use fenced code blocks with a language tag for code.
- Name things precisely so the learner can branch on any term you introduce.
- Do not pad with summaries or offers of further help; the interface handles follow-ups.`;

export const SUGGEST_PROMPT = `You are helping a learner explore a topic as a tree of questions.
Given the conversation so far, propose 6 sharp follow-up questions the learner could branch into next.
Mix: 2 that go deeper into what was just said, 2 that challenge or probe edge cases / "but why", 2 that connect to adjacent concepts worth knowing.
Avoid repeating any question the learner already asked. Each under 90 characters, self-contained, no numbering.
Reply with ONLY a JSON array of strings.`;

export function titlePrompt(question: string) {
  return `Give a 2-5 word title for a learning session that starts with this question. Reply with the title only: no quotes, no trailing punctuation.\n\nQuestion: ${question.slice(0, 600)}`;
}

export function userText(question: string, quote?: string) {
  if (!quote?.trim()) return question;
  const quoted = quote
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `${quoted}\n\n${question}`;
}

/** Flatten a root→node path into chat turns. Unanswered ancestors (parked, failed) are skipped. */
export function buildMessages(path: TreeNode[], next?: { question: string; quote?: string }): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const n of path) {
    if (!n.answer.trim()) continue;
    out.push({ role: "user", content: userText(n.question, n.quote) });
    out.push({ role: "assistant", content: n.answer });
  }
  if (next) out.push({ role: "user", content: userText(next.question, next.quote) });
  return out;
}

export function cleanTitle(raw: string): string | undefined {
  const line = raw.trim().split("\n").find((l) => l.trim()) ?? "";
  const t = line.replace(/^(title\s*:)/i, "").replace(/^["'#*\s]+|["'*\s.]+$/g, "").slice(0, 60);
  return t || undefined;
}

export function parseSuggestions(text: string): string[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const arr: unknown = JSON.parse(m[0]);
      if (Array.isArray(arr)) {
        return arr
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8);
      }
    } catch {
      /* fall through to line parsing */
    }
  }
  return text
    .split("\n")
    .map((l) => l.replace(/^[\s\-*\d.)"]+|[",]+$/g, "").trim())
    .filter((l) => l.length > 8 && l.length < 160)
    .slice(0, 8);
}
