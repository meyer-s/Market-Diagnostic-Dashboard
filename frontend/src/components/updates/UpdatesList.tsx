import type { UpdatePostListItem } from "../../types/updates";
import { UPDATE_STATUS_STYLES, formatUpdateDate } from "./updateStyles";

interface UpdatesListProps {
  posts: UpdatePostListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function UpdatesList({
  posts,
  selectedId,
  onSelect,
}: UpdatesListProps) {
  return (
    <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.8)]">
      <div className="border-b border-stealth-700 px-4 py-3">
        <h2 className="text-sm font-semibold text-stealth-100">Posts</h2>
      </div>
      <div className="max-h-[68vh] overflow-y-auto p-2">
        {posts.map((post) => {
          const isActive = post.id === selectedId;
          return (
            <button
              key={post.id}
              type="button"
              onClick={() => onSelect(post.id)}
              className={`mb-2 w-full rounded-2xl border px-3 py-3 text-left transition ${
                isActive
                  ? "border-stealth-500 bg-stealth-700/70"
                  : "border-stealth-700 bg-stealth-850/70 hover:border-stealth-600 hover:bg-stealth-750/70"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${UPDATE_STATUS_STYLES[post.status].pill}`}
                >
                  {post.status}
                </div>
                <div className="text-xs text-stealth-500">{formatUpdateDate(post.created_at)}</div>
              </div>
              <div className="line-clamp-2 text-sm font-semibold text-stealth-100">{post.title}</div>
              <div className="mt-1 line-clamp-2 text-xs text-stealth-400">{post.summary}</div>
              {post.pinned && <div className="mt-2 text-[10px] font-semibold text-stealth-300">PINNED</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
