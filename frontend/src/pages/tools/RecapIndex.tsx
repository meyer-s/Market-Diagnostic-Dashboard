import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import SearchInput from "../../components/updates/SearchInput";
import StatusFilterChips from "../../components/updates/StatusFilterChips";
import UpdatesList from "../../components/updates/UpdatesList";
import { useApi } from "../../hooks/useApi";
import type { UpdatePostListItem, UpdateStatus } from "../../types/updates";
import { ErrorState } from "../../utils/componentUtils";

type StatusFilter = "ALL" | UpdateStatus;

export default function RecapIndex() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const endpoint = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "100");
    params.set("offset", "0");
    if (statusFilter !== "ALL") {
      params.set("status", statusFilter);
    }
    if (searchQuery) {
      params.set("q", searchQuery);
    }
    return `/updates?${params.toString()}`;
  }, [searchQuery, statusFilter]);

  const { data, loading, error } = useApi<UpdatePostListItem[]>(endpoint);
  const posts = useMemo(
    () =>
      [...(data ?? [])].sort((a, b) => {
        if (a.pinned !== b.pinned) {
          return a.pinned ? -1 : 1;
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }),
    [data],
  );

  useEffect(() => {
    if (posts.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !posts.some((post) => post.id === selectedId)) {
      setSelectedId(posts[0].id);
    }
  }, [posts, selectedId]);

  const handleOpenPost = (id: string) => {
    const post = posts.find((item) => item.id === id);
    if (!post) {
      return;
    }
    navigate(`/tools/recap/${post.slug}`);
  };

  return (
    <div className="space-y-4 p-4 text-stealth-100 md:space-y-6 md:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stealth-100">Recap</h1>
          <p className="mt-1 text-sm text-stealth-400">
            Browse recap posts. Open any title for a dedicated post page.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
          <div className="sm:min-w-[280px]">
            <SearchInput value={searchInput} onChange={setSearchInput} />
          </div>
          <StatusFilterChips value={statusFilter} onChange={setStatusFilter} />
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 p-6 text-sm text-stealth-400">
          Loading recap posts...
        </div>
      ) : error ? (
        <ErrorState message={error} />
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 p-6 text-sm text-stealth-400">
          No recap posts match the current filters.
        </div>
      ) : (
        <UpdatesList posts={posts} selectedId={selectedId} onSelect={handleOpenPost} />
      )}
    </div>
  );
}
