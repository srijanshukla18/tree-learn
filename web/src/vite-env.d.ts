/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_BACKEND?: "hosted" | "local";
  readonly VITE_OPENROUTER_BASE?: string;
  readonly VITE_OPENROUTER_AUTH?: string;
  readonly VITE_REPO_URL?: string;
}
