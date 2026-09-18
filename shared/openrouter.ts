import type { LLM, LLMEvent, LLMRequest, ModelCatalog, ModelInfo } from "./types.ts";

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
export const OPENROUTER_AUTH = "https://openrouter.ai/auth";

/** Preferred defaults, best first. OpenRouter's "~…-latest" aliases never go stale. */
const DEFAULT_CANDIDATES = ["~deepseek/deepseek-flash-latest", "~google/gemini-flash-latest", "~anthropic/claude-haiku-latest", "~openai/gpt-mini-latest"];
const EFFORT: Record<string, string> = { off: "none", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };

export interface OpenRouterOptions {
  getKey(): string | undefined;
  baseUrl?: string;
  /** Sent as HTTP-Referer / X-Title so usage is attributed to the app in the user's OpenRouter dashboard. */
  appUrl?: string;
  appTitle?: string;
  favorites?(): string[];
  fetch?: typeof fetch;
}

interface RawModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  architecture?: { output_modalities?: string[] };
}

export class MissingKeyError extends Error {
  constructor() {
    super("Connect your OpenRouter account first.");
  }
}

export function createOpenRouterLLM(opts: OpenRouterOptions): LLM {
  const base = (opts.baseUrl ?? OPENROUTER_BASE).replace(/\/$/, "");
  const doFetch: typeof fetch = (...a) => (opts.fetch ?? fetch)(...a);
  let cached: { at: number; models: ModelInfo[] } | undefined;

  const headers = (): Record<string, string> => {
    const key = opts.getKey();
    if (!key) throw new MissingKeyError();
    const h: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    if (opts.appUrl) h["HTTP-Referer"] = opts.appUrl;
    if (opts.appTitle) h["X-Title"] = opts.appTitle;
    return h;
  };

  async function loadModels(): Promise<ModelInfo[]> {
    if (cached && Date.now() - cached.at < 3_600_000) return cached.models;
    const res = await doFetch(`${base}/models`);
    if (!res.ok) throw new Error(`Could not load the OpenRouter model list (${res.status}).`);
    const raw = ((await res.json()) as { data: RawModel[] }).data;
    const models = raw
      .filter((m) => !m.id.endsWith(":batch") && (m.architecture?.output_modalities ?? ["text"]).includes("text"))
      .map((m): ModelInfo => {
        const reasoning = (m.supported_parameters ?? []).includes("reasoning");
        const slash = m.id.indexOf("/");
        return {
          id: m.id,
          provider: m.id.slice(0, slash).replace(/^~/, ""),
          modelId: m.id.slice(slash + 1),
          name: m.name,
          reasoning,
          thinkingLevels: reasoning ? ["auto", "off", "low", "medium", "high"] : ["auto"],
          contextWindow: m.context_length ?? 0,
          cost: { input: Number(m.pricing?.prompt ?? 0) * 1e6, output: Number(m.pricing?.completion ?? 0) * 1e6 },
          enabled: m.id.startsWith("~"),
        };
      });
    cached = { at: Date.now(), models };
    return models;
  }

  return {
    async catalog(): Promise<ModelCatalog> {
      const favorites = new Set(opts.favorites?.() ?? []);
      const models = (await loadModels())
        .map((m) => ({ ...m, enabled: m.enabled || favorites.has(m.id) }))
        .sort((a, b) => Number(b.enabled) - Number(a.enabled) || Number(favorites.has(b.id)) - Number(favorites.has(a.id)) || a.name.localeCompare(b.name));
      const ids = new Set(models.map((m) => m.id));
      const defaultModel = DEFAULT_CANDIDATES.find((id) => ids.has(id)) ?? models.find((m) => m.enabled)?.id ?? models[0]?.id;
      return { models, defaultModel, defaultThinking: "auto" };
    },

    async *stream(req: LLMRequest): AsyncIterable<LLMEvent> {
      const effort = req.thinkingLevel ? EFFORT[req.thinkingLevel] : undefined;
      const body = {
        model: req.model,
        stream: true,
        usage: { include: true },
        messages: [...(req.system ? [{ role: "system", content: req.system }] : []), ...req.messages],
        ...(effort ? { reasoning: { effort } } : {}),
      };
      let res: Response;
      try {
        res = await doFetch(`${base}/chat/completions`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: req.signal });
      } catch (err) {
        if (req.signal?.aborted) return;
        throw err instanceof MissingKeyError ? err : new Error("Could not reach OpenRouter. Check your connection.");
      }
      if (!res.ok || !res.body) throw new Error(await describeFailure(res));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith("data:")) continue; // blank lines and ": OPENROUTER PROCESSING" keep-alives
            const data = line.slice(5).trim();
            if (data === "[DONE]") return;
            yield* parseChunk(data);
          }
        }
      } catch (err) {
        if (req.signal?.aborted) return;
        throw err;
      } finally {
        reader.cancel().catch(() => {});
      }
    },
  };
}

interface Chunk {
  error?: { message?: string; code?: number | string };
  choices?: { delta?: { content?: string | null; reasoning?: string | null; reasoning_details?: { type?: string; text?: string; summary?: string }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

function* parseChunk(data: string): Iterable<LLMEvent> {
  let chunk: Chunk;
  try {
    chunk = JSON.parse(data) as Chunk;
  } catch {
    return;
  }
  if (chunk.error) throw new Error(chunk.error.message ?? "OpenRouter reported an error mid-stream.");
  const delta = chunk.choices?.[0]?.delta;
  if (delta) {
    // `reasoning` mirrors `reasoning_details`; read one of them, never both.
    const thinking = delta.reasoning || (delta.reasoning_details ?? []).map((d) => d.text ?? d.summary ?? "").join("");
    if (thinking) yield { type: "thinking", text: thinking };
    if (delta.content) yield { type: "text", text: delta.content };
  }
  if (chunk.usage) {
    yield { type: "usage", usage: { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0, cost: chunk.usage.cost ?? 0 } };
  }
}

async function describeFailure(res: Response): Promise<string> {
  let detail = "";
  try {
    const j = (await res.json()) as { error?: { message?: string; metadata?: { raw?: string } } };
    detail = j.error?.metadata?.raw ?? j.error?.message ?? "";
  } catch {
    /* no JSON body */
  }
  if (res.status === 401) return "OpenRouter rejected the API key. Reconnect your account in Settings.";
  if (res.status === 402) return "Your OpenRouter account is out of credits.";
  if (res.status === 429) return `Rate limited by OpenRouter. ${detail}`.trim();
  return detail || `OpenRouter request failed (${res.status}).`;
}

// ---------- OAuth (PKCE): the user authorises on openrouter.ai and we receive an app-specific, revocable key ----------

function base64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function authorizeUrl(callbackUrl: string, challenge: string, authUrl = OPENROUTER_AUTH) {
  const u = new URL(authUrl);
  u.searchParams.set("callback_url", callbackUrl);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export async function exchangeCode(code: string, verifier: string, baseUrl = OPENROUTER_BASE): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  if (!res.ok) throw new Error(`OpenRouter did not issue a key (${res.status}). Try connecting again.`);
  const { key } = (await res.json()) as { key?: string };
  if (!key) throw new Error("OpenRouter did not issue a key. Try connecting again.");
  return key;
}
