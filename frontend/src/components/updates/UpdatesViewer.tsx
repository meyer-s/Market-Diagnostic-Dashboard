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
}

export default function UpdatesViewer({
  post,
  loading,
  error,
  onOpenChart,
}: UpdatesViewerProps) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90">
        <LoadingState message="Loading post..." />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  if (!post) {
    return (
      <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 p-6">
        <EmptyState message="No update selected yet." />
      </div>
    );
  }

  return (
    <article className="rounded-2xl border border-stealth-700 bg-stealth-800/90 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.8)]">
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
            }}
          >
            {post.content_markdown}
          </ReactMarkdown>
        </div>
      </section>
    </article>
  );
}
