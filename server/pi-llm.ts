import { statSync } from "node:fs";
import path from "node:path";
import { ModelRuntime, SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Api, type Message, type Model, type ThinkingLevel } from "@earendil-works/pi-ai";
import type { ChatMessage, LLM, LLMEvent, LLMRequest, ModelCatalog, ModelInfo } from "../shared/types.ts";

/**
 * Answers through pi: the same providers, models, API keys and OAuth logins as the `pi` CLI,
 * read from ~/.pi/agent. The runtime is rebuilt whenever one of pi's config files changes,
 * so enabling a model or logging in to a provider shows up here without a restart.
 */
const WATCHED = ["models.json", "auth.json", "settings.json"];

interface Pi {
  stamp: string;
  runtime: ModelRuntime;
  settings: SettingsManager;
}
let current: Promise<Pi> | undefined;
let currentStamp = "";

function stamp() {
  return WATCHED.map((f) => {
    try {
      return statSync(path.join(getAgentDir(), f)).mtimeMs;
    } catch {
      return 0;
    }
  }).join(":");
}

function pi(): Promise<Pi> {
  const now = stamp();
  if (!current || now !== currentStamp) {
    currentStamp = now;
    current = (async () => ({
      stamp: now,
      runtime: await ModelRuntime.create({ allowModelNetwork: true }),
      settings: SettingsManager.create(process.cwd(), getAgentDir()),
    }))();
    current.catch(() => (current = undefined));
  }
  return current;
}

const keyOf = (m: Model<Api>) => `${m.provider}/${m.id}`;

async function resolve(runtime: ModelRuntime, key: string): Promise<Model<Api>> {
  const slash = key.indexOf("/");
  const model = slash > 0 ? runtime.getModel(key.slice(0, slash), key.slice(slash + 1)) : undefined;
  if (!model) throw new Error(`pi does not know the model "${key}". Pick another one in the model menu.`);
  return model;
}

/** Map our level onto what this model supports; "off"/"auto"/unknown means "send no reasoning option". */
function reasoningFor(model: Model<Api>, level?: string): ThinkingLevel | undefined {
  if (!model.reasoning || !level || level === "off" || level === "auto") return undefined;
  const supported = getSupportedThinkingLevels(model).filter((l) => l !== "off") as ThinkingLevel[];
  if (supported.includes(level as ThinkingLevel)) return level as ThinkingLevel;
  const order: ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
  const want = order.indexOf(level as ThinkingLevel);
  return supported.sort((a, b) => Math.abs(order.indexOf(a) - want) - Math.abs(order.indexOf(b) - want))[0];
}

function toPiMessages(messages: ChatMessage[], model: Model<Api>): Message[] {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  return messages.map((m, i): Message =>
    m.role === "user"
      ? { role: "user", content: m.content, timestamp: i }
      : { role: "assistant", content: [{ type: "text", text: m.content }], api: model.api, provider: model.provider, model: model.id, usage: zero, stopReason: "stop", timestamp: i },
  );
}

export function createPiLLM(): LLM {
  return {
    async catalog(): Promise<ModelCatalog> {
      const { runtime, settings } = await pi();
      const enabled = new Set(settings.getEnabledModels() ?? []);
      const models: ModelInfo[] = (await runtime.getAvailable()).map((m) => ({
        id: keyOf(m),
        provider: m.provider,
        modelId: m.id,
        name: m.name,
        reasoning: m.reasoning,
        thinkingLevels: getSupportedThinkingLevels(m),
        contextWindow: m.contextWindow,
        cost: { input: m.cost?.input ?? 0, output: m.cost?.output ?? 0 },
        enabled: enabled.size === 0 || enabled.has(keyOf(m)),
      }));
      models.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.id.localeCompare(b.id));
      const provider = settings.getDefaultProvider();
      const model = settings.getDefaultModel();
      const preferred = provider && model ? `${provider}/${model}` : undefined;
      return {
        models,
        defaultModel: models.find((m) => m.id === preferred)?.id ?? models.find((m) => m.enabled)?.id ?? models[0]?.id,
        defaultThinking: settings.getDefaultThinkingLevel() ?? "medium",
      };
    },

    async *stream(req: LLMRequest): AsyncIterable<LLMEvent> {
      const { runtime } = await pi();
      const model = await resolve(runtime, req.model);
      const events = runtime.streamSimple(
        model,
        { systemPrompt: req.system, messages: toPiMessages(req.messages, model) },
        { reasoning: reasoningFor(model, req.thinkingLevel), signal: req.signal },
      );
      for await (const ev of events) {
        if (ev.type === "text_delta") yield { type: "text", text: ev.delta };
        else if (ev.type === "thinking_delta") yield { type: "thinking", text: ev.delta };
        else if (ev.type === "done") {
          const u = ev.message.usage;
          yield { type: "usage", usage: { input: u.input, output: u.output, cost: u.cost.total } };
        } else if (ev.type === "error") {
          if (ev.reason === "aborted" || req.signal?.aborted) return;
          throw new Error(ev.error.errorMessage ?? "The provider returned an error.");
        }
      }
    },
  };
}
