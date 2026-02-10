import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmptyState, ErrorState, LoadingState } from "../../utils/componentUtils";
import type { UpdatePostDetail } from "../../types/updates";
import { UPDATE_STATUS_STYLES, formatUpdateDate } from "./updateStyles";

interface UpdatesViewerProps {
  post: UpdatePostDetail | null;
  loading: boolean;
  error: string | null;
  onOpenChart: (index: number) => void;
  overlayLoading?: boolean;
  pendingTitle?: string | null;
}

// We normalize `(Source: https://...)` into a stable token so ReactMarkdown doesn't split it into <a> nodes.
const SOURCE_TOKEN_PATTERN = /\s*\[\[SOURCE:\s*([^\]]+)\]\]\s*$/;
const SOURCE_PAREN_PATTERN = /\s*\(Source:\s*([^)]+)\)\s*$/;
const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim());

const HOST_LABEL_OVERRIDES: Record<string, string> = {
  "fred.stlouisfed.org": "FRED",
  "www.atlantafed.org": "Atlanta Fed",
  "www.ismworld.org": "ISM",
  "www.reuters.com": "Reuters",
  "insight.factset.com": "FactSet",
  "www.conference-board.org": "Conference Board",
  "tradingeconomics.com": "TradingEconomics",
  "www.tradingeconomics.com": "TradingEconomics",
  "www.newyorkfed.org": "NY Fed",
  "www.federalreserve.gov": "Fed",
};

const labelFromUrl = (url: string) => {
  const raw = url.trim();
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase();
    const hostLabel = HOST_LABEL_OVERRIDES[hostname];
    if (hostLabel) {
      return hostLabel;
    }
    return hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
};

const normalizeMarkdownSources = (markdown: string) => {
  // Replace only when it appears as a trailing citation (typically at end-of-bullet).
  return markdown
    .split("\n")
    .map((line) => {
      const match = line.match(SOURCE_PAREN_PATTERN);
      if (!match) {
        return line;
      }
      const cleaned = line.replace(SOURCE_PAREN_PATTERN, "").trimEnd();
      const source = (match[1] || "").trim();
      return `${cleaned} [[SOURCE:${source}]]`;
    })
    .join("\n");
};

const stripSourceFromNode = (
  node: React.ReactNode,
): { node: React.ReactNode; source?: string } => {
  if (typeof node === "string") {
    const match = node.match(SOURCE_TOKEN_PATTERN);
    if (!match) {
      return { node };
    }
    const cleaned = node.replace(SOURCE_TOKEN_PATTERN, "").trimEnd();
    return { node: cleaned, source: match[1]?.trim() };
  }

  if (Array.isArray(node)) {
    const items = [...node];
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const result = stripSourceFromNode(items[i]);
      if (result.source) {
        items[i] = result.node;
        return { node: items, source: result.source };
      }
    }
    return { node: items };
  }

  if (React.isValidElement(node)) {
    const result = stripSourceFromNode(node.props.children);
    if (result.source) {
      return {
        node: React.cloneElement(node, { ...node.props }, result.node),
        source: result.source,
      };
    }
    return { node };
  }

  return { node };
};

const renderSourceTag = (source?: string) => {
  const url = (source || "").trim();
  if (!url) {
    return <span className="md-source-tag">missing</span>;
  }
  if (isHttpUrl(url)) {
    const label = labelFromUrl(url);
    return (
      <span className="md-source-tag">
        <a className="md-source-link" href={url} target="_blank" rel="noreferrer noopener" title={url}>
          {label}
        </a>
      </span>
    );
  }
  return <span className="md-source-tag">{url}</span>;
};

export default function UpdatesViewer({
  post,
  loading,
  error,
  onOpenChart,
  overlayLoading = false,
  pendingTitle = null,
}: UpdatesViewerProps) {
  const [fadeIn, setFadeIn] = useState(true);
  const postKey = post?.id ?? "empty";

  useEffect(() => {
    // Trigger a short fade-in whenever the displayed post changes.
    setFadeIn(false);
    const raf = window.requestAnimationFrame(() => setFadeIn(true));
    return () => window.cancelAnimationFrame(raf);
  }, [postKey]);

  const headerLabel = useMemo(() => {
    if (!overlayLoading) {
      return null;
    }
    if (pendingTitle) {
      return `Loading: ${pendingTitle}`;
    }
    return "Loading selected post...";
  }, [overlayLoading, pendingTitle]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 min-h-[68vh]">
        <LoadingState message="Loading post..." />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  if (!post) {
    return (
      <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 p-6 min-h-[68vh]">
        <EmptyState message="No update selected yet." />
      </div>
    );
  }

  const normalizedMarkdown = useMemo(() => normalizeMarkdownSources(post.content_markdown), [post.content_markdown]);

  return (
    <article className="relative rounded-2xl border border-stealth-700 bg-stealth-800/90 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.8)] min-h-[68vh] overflow-hidden">
      <div
        key={postKey}
        className={[
          "transition-opacity duration-200 motion-reduce:transition-none",
          fadeIn ? "opacity-100" : "opacity-0",
          overlayLoading ? "pointer-events-none opacity-90" : "",
        ].join(" ")}
      >
        <header className="border-b border-stealth-700 px-5 py-5 md:px-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${UPDATE_STATUS_STYLES[post.status].pill}`}
            >
              {post.status}
            </span>
            <span className="text-xs text-stealth-500">{formatUpdateDate(post.created_at)}</span>
            {post.pinned && <span className="ml-auto text-xs font-semibold text-stealth-300">PINNED</span>}
          </div>
          <h1 className="text-2xl font-semibold text-stealth-100">{post.title}</h1>
          <p className="mt-2 text-sm text-stealth-300">{post.summary}</p>
          {post.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-stealth-700 bg-stealth-850 px-2.5 py-1 text-[11px] text-stealth-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </header>

        {post.chart_urls.length > 0 && (
          <section className="border-b border-stealth-700 px-5 py-5 md:px-6">
            <h2 className="mb-3 text-sm font-semibold text-stealth-200">Charts</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {post.chart_urls.map((url, index) => (
                <button
                  key={`${post.id}-chart-${index}`}
                  type="button"
                  onClick={() => onOpenChart(index)}
                  className="group overflow-hidden rounded-xl border border-stealth-700 bg-stealth-850 text-left"
                >
                  <img
                    src={url}
                    alt={`${post.title} chart ${index + 1}`}
                    loading="lazy"
                    className="h-36 w-full object-cover transition duration-300 group-hover:scale-[1.01]"
                  />
                  <div className="px-3 py-2 text-xs text-stealth-400">Open chart {index + 1}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="px-5 py-5 md:px-6">
          <div className="text-sm leading-7 text-stealth-200 [&_h1]:mt-8 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-stealth-100 [&_h2]:mt-7 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-stealth-100 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-stealth-100 [&_hr]:my-6 [&_hr]:border-stealth-700 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_li]:text-stealth-200 [&_table]:mt-4 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-lg [&_th]:border [&_th]:border-stealth-700 [&_th]:bg-stealth-850 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:border-stealth-700 [&_td]:px-3 [&_td]:py-2 [&_a]:text-pulse-400 [&_a]:underline-offset-2 hover:[&_a]:text-blue-300 [&_img]:mt-4 [&_img]:rounded-xl [&_img]:border [&_img]:border-stealth-700">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
                img: ({ node: _node, ...props }) => <img {...props} loading="lazy" alt={props.alt || "Chart"} />,
                li: ({ node: _node, children, ...props }) => {
                  const { node: cleaned, source } = stripSourceFromNode(children);
                  return (
                    <li {...props}>
                      {cleaned}
                      {renderSourceTag(source)}
                    </li>
                  );
                },
              }}
            >
              {normalizedMarkdown}
            </ReactMarkdown>
          </div>
        </section>
      </div>

      {overlayLoading && (
        <div className="absolute inset-0 flex items-start justify-center bg-stealth-950/45 backdrop-blur-[1px]">
          <div className="mt-6 w-[min(560px,92%)] rounded-2xl border border-stealth-700 bg-stealth-900/80 p-4 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.8)]">
            <div className="h-1 w-full overflow-hidden rounded-full bg-stealth-800">
              <div className="h-full w-1/2 animate-[updatesIndeterminate_900ms_ease-in-out_infinite] motion-reduce:animate-none rounded-full bg-stealth-500/70" />
            </div>
            <div className="mt-3 text-xs font-semibold text-stealth-200">{headerLabel}</div>
            <div className="mt-3 space-y-2">
              <div className="h-3 w-3/4 animate-pulse rounded bg-stealth-800" />
              <div className="h-3 w-full animate-pulse rounded bg-stealth-800" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-stealth-800" />
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
