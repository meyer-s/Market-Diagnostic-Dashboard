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

  const handleOpenPost = (id: string) => {
    const post = posts.find((item) => item.id === id);
    if (!post) {
      return;
    }
    navigate(`/tools/recap/${post.slug}`);
  };

  return (
    <div className="page-shell page-stack">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="page-kicker">Research archive</span>
          <h1 className="page-title">Market Recaps</h1>
          <p className="page-subtitle">
            Browse published market-state recaps and open a dedicated reading view.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
          <div className="sm:min-w-[280px]">
            <SearchInput value={searchInput} onChange={setSearchInput} />
          </div>
          <StatusFilterChips value={statusFilter} onChange={setStatusFilter} />
        </div>
      </header>

      {loading ? (
        <div
          className="rounded-2xl border border-stealth-700 bg-stealth-800/90 p-6 text-sm text-stealth-300"
          role="status"
          aria-live="polite"
        >
          Loading recap posts…
        </div>
      ) : error ? (
        <ErrorState message={error} />
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 p-6 text-sm text-stealth-300">
          No recap posts match the current filters.
        </div>
      ) : (
        <section aria-labelledby="recap-results-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="recap-results-heading" className="text-lg font-semibold text-stealth-100">
              Recap posts
            </h2>
            <p className="text-sm text-stealth-300" aria-live="polite">
              {posts.length} result{posts.length === 1 ? "" : "s"}
            </p>
          </div>
          <UpdatesList posts={posts} selectedId={null} onSelect={handleOpenPost} />
        </section>
      )}
    </div>
  );
}
