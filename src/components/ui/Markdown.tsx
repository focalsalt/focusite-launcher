import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { openExternal } from "@/lib/openExternal";

// Project pages mix markdown with raw HTML: parse it, then sanitize (no scripts/handlers). Links open externally.
const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) void openExternal(href);
      }}
      className="cursor-pointer text-brand-light underline-offset-2 hover:underline"
    >
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    typeof src === "string" && /^https:\/\//i.test(src) ? (
      <img src={src} alt={alt ?? ""} loading="lazy" className="my-2 max-w-full rounded-lg" />
    ) : null,
  h1: ({ children }) => <h3 className="mt-4 mb-2 text-base font-bold text-slate-100">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-4 mb-2 text-sm font-bold text-slate-100">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-3 mb-1.5 text-xs font-bold text-slate-200">{children}</h5>,
  p: ({ children }) => <p className="my-2">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  code: ({ children }) => (
    <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-2xs text-slate-200">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-2xs">{children}</pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-white/20 pl-3 text-slate-500">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-white/10" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-2xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-white/10 px-2 py-1 text-left text-slate-200">{children}</th>,
  td: ({ children }) => <td className="border border-white/10 px-2 py-1">{children}</td>,
};

export const Markdown: React.FC<{ children: string }> = ({ children }) => (
  <div className="select-text break-words text-xs leading-relaxed text-slate-400">
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={components}>
      {children}
    </ReactMarkdown>
  </div>
);
