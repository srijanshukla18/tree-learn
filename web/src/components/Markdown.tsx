import { memo, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import "katex/dist/katex.min.css";
import { normalizeMath } from "../lib/mathfix";

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const className = (typeof child === "object" && child && "props" in child ? (child.props as { className?: string }).className : "") ?? "";
  const lang = /language-([\w+#-]+)/.exec(className)?.[1] ?? "text";
  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span>{lang}</span>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(textOf(children).replace(/\n$/, ""));
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

/** Answers are untrusted text: no raw HTML, no remote images (they would leak what you read to third parties). */
const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const source = useMemo(() => normalizeMath(text), [text]);
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
          img: ({ src, alt }) => (
            <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noreferrer noopener">
              {alt || "image"}
            </a>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          table: ({ node: _n, ...props }) => (
            <div className="table-wrap">
              <table {...props} />
            </div>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
      {streaming && <span className="caret" />}
    </div>
  );
});

export default Markdown;
