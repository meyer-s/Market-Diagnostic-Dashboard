import type { UpdatePostListItem } from "../../types/updates";
import { UPDATE_STATUS_STYLES, formatUpdateDate } from "./updateStyles";

const MARKET_DIAGNOSTIC_SLUG_PREFIX = "market-diagnostic-";
const MARKET_DIAGNOSTIC_SLUG_DATE_PATTERN = /^market-diagnostic-(\d{4})-(\d{2})-(\d{2})$/;

const isScheduledRecapDay = (date: Date) => {
  const day = date.getUTCDay();
  return day === 1 || day === 4; // Monday or Thursday
};

const parseMarketDiagnosticSlugDate = (slug: string): Date | null => {
  if (!slug.startsWith(MARKET_DIAGNOSTIC_SLUG_PREFIX)) {
    return null;
  }
  const match = slug.match(MARKET_DIAGNOSTIC_SLUG_DATE_PATTERN);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
};

const getMissingScheduledRecapDatesBetween = (newerPost: UpdatePostListItem, olderPost: UpdatePostListItem): Date[] => {
  if (newerPost.pinned || olderPost.pinned) {
    return [];
  }
  const newerDate = parseMarketDiagnosticSlugDate(newerPost.slug);
  const olderDate = parseMarketDiagnosticSlugDate(olderPost.slug);
  if (!newerDate || !olderDate || newerDate.getTime() <= olderDate.getTime()) {
    return [];
  }

  const missing: Date[] = [];
  const cursor = new Date(olderDate);
  cursor.setUTCDate(cursor.getUTCDate() + 1);

  while (cursor.getTime() < newerDate.getTime()) {
    if (isScheduledRecapDay(cursor)) {
      missing.push(new Date(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return missing;
};

const formatSkippedDateLabel = (date: Date) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);

interface UpdatesListProps {
  posts: UpdatePostListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPrefetch?: (id: string) => void;
}

export default function UpdatesList({
  posts,
  selectedId,
  onSelect,
  onPrefetch,
}: UpdatesListProps) {
  return (
    <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.8)]">
      <div className="border-b border-stealth-700 px-4 py-3">
        <h2 className="text-sm font-semibold text-stealth-100">Posts</h2>
      </div>
      <div className="max-h-[68vh] overflow-y-auto p-2">
        {posts.map((post, index) => {
          const isActive = post.id === selectedId;
          const isSpecialEventPost = post.tags.includes("event-summary") || post.tags.includes("jobs-day");
          const olderPost = posts[index + 1];
          const missingScheduledDates = olderPost
            ? getMissingScheduledRecapDatesBetween(post, olderPost)
            : [];

          return (
            <div key={post.id}>
              <button
                type="button"
                onClick={() => onSelect(post.id)}
                onMouseEnter={() => onPrefetch?.(post.id)}
                onFocus={() => onPrefetch?.(post.id)}
                className={`mb-2 w-full rounded-2xl border px-3 py-3 text-left transition ${
                  isActive
                    ? "border-stealth-500 bg-stealth-700/70"
                    : "border-stealth-700 bg-stealth-850/70 hover:border-stealth-600 hover:bg-stealth-750/70"
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${UPDATE_STATUS_STYLES[post.status].pill}`}
                    >
                      {post.status}
                    </div>
                    {isSpecialEventPost && (
                      <div className="rounded-full border border-cyan-300/60 bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
                        EVENT
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-stealth-500">{formatUpdateDate(post.created_at)}</div>
                </div>
                <div className="line-clamp-2 text-sm font-semibold text-stealth-100">{post.title}</div>
                {post.pinned && <div className="mt-2 text-[10px] font-semibold text-stealth-300">PINNED</div>}
              </button>

              {missingScheduledDates.length > 0 && (
                <div className="mb-2 rounded-xl border border-amber-400/35 border-dashed bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-200">
                  <div className="font-semibold uppercase tracking-[0.12em] text-amber-300/90">Skipped Recap</div>
                  <div className="mt-0.5 text-amber-100/90">
                    {missingScheduledDates.length === 1
                      ? formatSkippedDateLabel(missingScheduledDates[0])
                      : missingScheduledDates.map(formatSkippedDateLabel).join(", ")}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
