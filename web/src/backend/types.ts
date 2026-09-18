import type { EngineAPI } from "@shared/types";

/** Hosted mode only: the learner's own OpenRouter key, kept in this browser. */
export interface KeyVault {
  hasKey(): boolean;
  /** Last four characters, for display. */
  hint(): string | undefined;
  setKey(key: string): void;
  clearKey(): void;
  /** Send the learner to openrouter.ai to authorise this app (OAuth PKCE). */
  beginConnect(): Promise<void>;
  /** If we just came back from openrouter.ai, trade the code for a key. */
  completeConnect(): Promise<"connected" | "none">;
  favorites(): string[];
  toggleFavorite(modelId: string): void;
  onChange(cb: () => void): () => void;
}

export interface Backend extends EngineAPI {
  kind: "local" | "hosted";
  /** Calls back when the tree may have changed outside this tab. */
  subscribe(treeId: string, onChange: () => void): () => void;
  vault?: KeyVault;
}
