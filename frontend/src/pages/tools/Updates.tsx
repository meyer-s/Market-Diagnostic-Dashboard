import { useEffect, useMemo, useRef, useState } from "react";
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
  const [displayId, setDisplayId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, UpdatePostDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [activeChartIndex, setActiveChartIndex] = useState(0);
  const prefetchInFlight = useRef<Set<string>>(new Set());

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
      setDisplayId(null);
      return;
    }
    if (selectedId && posts.some((post) => post.id === selectedId)) {
      return;
    }
    setSelectedId(posts[0].id);
  }, [posts, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    // If we already have the details, swap immediately for a smoother feel.
    if (detailCache[selectedId]) {
      if (displayId !== selectedId) {
        setDisplayId(selectedId);
      }
      return;
    }

    // Keep rendering the previous post while we fetch the new one.
    if (!displayId) {
      setDisplayId(selectedId);
    }

    if (detailCache[selectedId]) {
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
        // If this is still the selected post, swap the viewer now.
        if (selectedId === post.id) {
          setDisplayId(post.id);
        }
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
  }, [detailCache, displayId, selectedId]);

  const selectedPost = selectedId ? detailCache[selectedId] || null : null;
  const displayedPost = displayId ? detailCache[displayId] || null : null;

  const openChart = (index: number) => {
    setActiveChartIndex(index);
    setGalleryOpen(true);
  };

  const viewerLoading = Boolean(selectedId) && !displayedPost && detailLoading;
  const viewerOverlayLoading =
    Boolean(selectedId) &&
    Boolean(displayedPost) &&
    displayId !== selectedId &&
    !selectedPost &&
    detailLoading;
  const pendingTitle = selectedId ? posts.find((p) => p.id === selectedId)?.title ?? null : null;

  const prefetchPost = (id: string) => {
    if (!id || detailCache[id] || prefetchInFlight.current.has(id)) {
      return;
    }
    prefetchInFlight.current.add(id);
    apiFetch<UpdatePostDetail>(`/updates/${id}`)
      .then((post) => {
        setDetailCache((prev) => ({ ...prev, [post.id]: post }));
      })
      .catch(() => {
        // Prefetch is best-effort; ignore errors.
      })
      .finally(() => {
        prefetchInFlight.current.delete(id);
      });
  };

  return (
    <div className="space-y-4 p-4 text-stealth-100 md:space-y-6 md:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stealth-100">Recap</h1>
          <p className="mt-1 text-sm text-stealth-400">
            Weekly market recap with markdown write-ups and chart snapshots.
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
              Loading recap posts...
            </div>
          ) : postsError ? (
            <ErrorState message={postsError} />
          ) : posts.length === 0 ? (
            <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 p-6 text-sm text-stealth-400">
              No recap posts match the current filters.
            </div>
          ) : (
            <UpdatesList posts={posts} selectedId={selectedId} onSelect={setSelectedId} onPrefetch={prefetchPost} />
          )}
        </div>

        <UpdatesViewer
          post={displayedPost}
          loading={viewerLoading}
          error={detailError}
          onOpenChart={openChart}
          overlayLoading={viewerOverlayLoading}
          pendingTitle={pendingTitle}
        />
      </div>

      <ChartGallery
        isOpen={galleryOpen}
        urls={displayedPost?.chart_urls ?? []}
        initialIndex={activeChartIndex}
        onClose={() => setGalleryOpen(false)}
      />
    </div>
  );
}
