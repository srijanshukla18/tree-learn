/**
 * A pretend OpenRouter for developing and testing hosted mode offline, without a key or credits.
 *   npx tsx scripts/mock-openrouter.ts            (listens on :4750)
 *   VITE_OPENROUTER_BASE=http://localhost:4750/api/v1 VITE_OPENROUTER_AUTH=http://localhost:4750/auth npm run dev:hosted
 * It implements the three things the app uses: the model list, streaming chat completions, and the OAuth PKCE exchange
 * (verifying the code challenge for real, so the client's PKCE maths is exercised).
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4750);
const challenges = new Map<string, string>(); // code → code_challenge

const models = [
  { id: "~mock/fast-latest", name: "Mock: Fast (latest)", context_length: 128000, pricing: { prompt: "0.0000001", completion: "0.0000004" }, supported_parameters: ["reasoning", "max_tokens"], architecture: { output_modalities: ["text"] } },
  { id: "mock/thinker-1", name: "Mock: Thinker 1", context_length: 200000, pricing: { prompt: "0.000003", completion: "0.000015" }, supported_parameters: ["reasoning", "max_tokens"], architecture: { output_modalities: ["text"] } },
  { id: "mock/plain-1", name: "Mock: Plain 1", context_length: 32000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["max_tokens"], architecture: { output_modalities: ["text"] } },
  { id: "mock/plain-1:batch", name: "Mock: Plain 1 (batch)", context_length: 32000, pricing: { prompt: "0", completion: "0" }, supported_parameters: [], architecture: { output_modalities: ["text"] } },
];

function answerFor(question: string): string {
  if (/2-5 word title/i.test(question)) return "Mock Topic Title";
  if (/JSON array of strings/i.test(question)) return JSON.stringify(["What is the first follow-up worth asking?", "Why does the mock server answer so quickly?", "How would this differ with a real model?", "What breaks if the stream is interrupted?"]);
  const topic = question.replace(/^>.*$/gm, "").trim().slice(0, 80);
  return `This is a **mock answer** about: _${topic}_.\n\nIt streams like the real thing so you can test the interface:\n\n- a list item with \`inline code\`\n- a formula, $e^{i\\pi} + 1 = 0$\n\n\`\`\`ts\nconst tree = grow(question);\n\`\`\`\n\n| Column | Value |\n| --- | --- |\n| mode | hosted |\n| cost | none |\n\nSelect any phrase here to branch from it.`;
}

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type,http-referer,x-title", "access-control-allow-methods": "GET,POST,OPTIONS" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (req.method === "OPTIONS") return void res.writeHead(204, cors).end();
  const json = (status: number, body: unknown) => res.writeHead(status, { ...cors, "content-type": "application/json" }).end(JSON.stringify(body));
  const readBody = async () => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    return JSON.parse(raw || "{}");
  };

  // OAuth: the real site shows a consent screen; the mock approves instantly and bounces back with a code.
  if (url.pathname === "/auth") {
    const back = new URL(url.searchParams.get("callback_url") ?? "http://localhost:5190/");
    const code = randomUUID();
    challenges.set(code, url.searchParams.get("code_challenge") ?? "");
    back.searchParams.set("code", code);
    return void res.writeHead(302, { location: back.toString() }).end();
  }
  if (url.pathname === "/api/v1/auth/keys" && req.method === "POST") {
    const { code, code_verifier } = await readBody();
    const expected = challenges.get(code);
    const actual = createHash("sha256").update(String(code_verifier ?? "")).digest("base64url");
    challenges.delete(code);
    if (!expected || expected !== actual) return json(403, { error: { message: "PKCE verification failed" } });
    return json(200, { key: "sk-or-v1-mock-" + randomUUID().slice(0, 8) });
  }

  if (url.pathname === "/api/v1/models") return json(200, { data: models });

  if (url.pathname === "/api/v1/chat/completions" && req.method === "POST") {
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || auth.includes("bad")) return json(401, { error: { message: "No auth credentials found", code: 401 } });
    const body = await readBody();
    const last = [...(body.messages ?? [])].reverse().find((m: { role: string }) => m.role === "user")?.content ?? "";
    res.writeHead(200, { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (delta: object, extra: object = {}) => res.write(`data: ${JSON.stringify({ id: "gen-mock", choices: [{ delta }], ...extra })}\n\n`);
    res.write(": OPENROUTER PROCESSING\n\n");
    const wantsThinking = body.reasoning?.effort !== "none" && !String(body.model).includes("plain");
    if (wantsThinking) {
      for (const part of ["The learner asked something. ", "A mock has no thoughts, ", "but it can pretend to have them."]) {
        send({ reasoning: part, reasoning_details: [{ type: "reasoning.text", text: part }] });
        await sleep(180);
      }
    }
    const text = answerFor(String(last));
    for (let i = 0; i < text.length && !res.destroyed; i += 7) {
      send({ content: text.slice(i, i + 7) });
      await sleep(18);
    }
    send({}, { usage: { prompt_tokens: 120, completion_tokens: Math.ceil(text.length / 4), cost: 0.00012 } });
    res.write("data: [DONE]\n\n");
    return void res.end();
  }

  json(404, { error: { message: "not found" } });
}).listen(port, () => console.log(`mock openrouter → http://localhost:${port}`));
