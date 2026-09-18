import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const root = import.meta.dirname;
const hosted = process.env.VITE_BACKEND === "hosted";
const openrouter = new URL(process.env.VITE_OPENROUTER_BASE || "https://openrouter.ai/api/v1").origin;

/**
 * Hosted builds ship a Cloudflare `_headers` file. The Content-Security-Policy is the trust story:
 * the browser itself refuses to send anything (your key included) anywhere except OpenRouter.
 */
function securityHeaders(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data:",
    `connect-src 'self' ${openrouter}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
  const file = [
    "/*",
    `  Content-Security-Policy: ${csp}`,
    "  Referrer-Policy: no-referrer",
    "  X-Content-Type-Options: nosniff",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()",
    "",
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n");
  return {
    name: "tree-learn-security-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: file });
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), ...(hosted ? [securityHeaders()] : [])],
  resolve: { alias: { "@shared": path.resolve(root, "..", "shared") } },
  server: {
    port: Number(process.env.WEB_PORT ?? (hosted ? 5190 : 5180)),
    fs: { allow: [path.resolve(root, "..")] },
    proxy: hosted ? undefined : { "/api": { target: process.env.TREE_LEARN_API ?? "http://localhost:4747", changeOrigin: true } },
  },
  build: {
    outDir: hosted ? "dist-hosted" : "dist",
    emptyOutDir: true,
  },
});
