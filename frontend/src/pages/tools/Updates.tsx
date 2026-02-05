import { useEffect, useMemo, useState } from "react";
import ChartGallery from "../../components/updates/ChartGallery";
import SearchInput from "../../components/updates/SearchInput";
import StatusFilterChips from "../../components/updates/StatusFilterChips";
import UpdatesList from "../../components/updates/UpdatesList";
import UpdatesViewer from "../../components/updates/UpdatesViewer";
import { useApi } from "../../hooks/useApi";
import type { UpdatePostDetail, UpdatePostListItem, UpdateStatus } from "../../types/updates";
import { ErrorState } from "../../utils/componentUtils";
import { apiFetch } from "../../utils/apiUtils";

type StatusFilter = "ALL" | UpdateStatus;

export default function Updates() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, UpdatePostDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [activeChartIndex, setActiveChartIndex] = useState(0);

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

  const {
    data: postsData,
    loading: postsLoading,
    error: postsError,
  } = useApi<UpdatePostListItem[]>(endpoint);
  const posts = useMemo(
    () =>
      [...(postsData ?? [])].sort((a, b) => {
        if (a.pinned !== b.pinned) {
          return a.pinned ? -1 : 1;
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }),
    [postsData]
  );

  useEffect(() => {
    if (posts.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && posts.some((post) => post.id === selectedId)) {
      return;
    }
    setSelectedId(posts[0].id);
  }, [posts, selectedId]);

  useEffect(() => {
    if (!selectedId || detailCache[selectedId]) {
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    apiFetch<UpdatePostDetail>(`/updates/${selectedId}`)
      .then((post) => {
        if (cancelled) {
          return;
        }
        setDetailCache((prev) => ({ ...prev, [post.id]: post }));
      })
      .catch((err: Error) => {
        if (cancelled) {
          return;
        }
        setDetailError(err.message || "Failed to load selected update.");
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailCache, selectedId]);

  const selectedPost = selectedId ? detailCache[selectedId] || null : null;

  const openChart = (index: number) => {
    setActiveChartIndex(index);
    setGalleryOpen(true);
  };

  const viewerLoading = Boolean(selectedId) && !selectedPost && detailLoading;

  return (
    <div className="space-y-4 p-4 text-stealth-100 md:space-y-6 md:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stealth-100">Updates</h1>
          <p className="mt-1 text-sm text-stealth-400">
            Internal market diagnostics feed with markdown write-ups and chart snapshots.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
          <div className="sm:min-w-[280px]">
            <SearchInput value={searchInput} onChange={setSearchInput} />
          </div>
          <StatusFilterChips value={statusFilter} onChange={setStatusFilter} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)] xl:gap-6">
        <div className="xl:sticky xl:top-20 xl:self-start">
          {postsLoading ? (
            <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 p-6 text-sm text-stealth-400">
              Loading updates...
            </div>
          ) : postsError ? (
            <ErrorState message={postsError} />
          ) : posts.length === 0 ? (
            <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 p-6 text-sm text-stealth-400">
              No posts match the current filters.
            </div>
          ) : (
            <UpdatesList posts={posts} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>

        <UpdatesViewer
          post={selectedPost}
          loading={viewerLoading}
          error={detailError}
          onOpenChart={openChart}
        />
      </div>

      <ChartGallery
        isOpen={galleryOpen}
        urls={selectedPost?.chart_urls ?? []}
        initialIndex={activeChartIndex}
        onClose={() => setGalleryOpen(false)}
      />
    </div>
  );
}
