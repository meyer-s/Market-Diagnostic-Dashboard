import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ChartGallery from "../../components/updates/ChartGallery";
import UpdatesList from "../../components/updates/UpdatesList";
import UpdatesViewer from "../../components/updates/UpdatesViewer";
import { useApi } from "../../hooks/useApi";
import type { UpdatePostDetail, UpdatePostListItem } from "../../types/updates";

export default function RecapPost() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [activeChartIndex, setActiveChartIndex] = useState(0);
  const [recentOpen, setRecentOpen] = useState(false);

  const detailEndpoint = slug ? `/updates/by-slug/${encodeURIComponent(slug)}` : "";
  const {
    data: post,
    loading: postLoading,
    error: postError,
  } = useApi<UpdatePostDetail>(detailEndpoint);

  const { data: recentData } = useApi<UpdatePostListItem[]>("/updates?limit=40&offset=0");
  const recentPosts = useMemo(
    () =>
      [...(recentData ?? [])].sort((a, b) => {
        if (a.pinned !== b.pinned) {
          return a.pinned ? -1 : 1;
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }),
    [recentData],
  );

  useEffect(() => {
    const originalTitle = document.title;
    if (post?.title) {
      document.title = `${post.title} | Recap`;
    } else if (slug) {
      document.title = `Recap | ${slug}`;
    }
    return () => {
      document.title = originalTitle;
    };
  }, [post?.title, slug]);

  useEffect(() => {
    setRecentOpen(false);
  }, [slug]);

  const openChart = (index: number) => {
    setActiveChartIndex(index);
    setGalleryOpen(true);
  };

  const closeGallery = useCallback(() => setGalleryOpen(false), []);

  const handleSelectRecent = (id: string) => {
    const target = recentPosts.find((item) => item.id === id);
    if (!target) {
      return;
    }
    navigate(`/tools/recap/${target.slug}`);
  };

  return (
    <div className="page-shell page-stack">
      <header className="flex items-center justify-between gap-3">
        <div>
          <span className="page-kicker">Research archive</span>
          <p className="mt-2 text-sm text-stealth-300">Dedicated recap reading view</p>
        </div>
        <Link
          to="/tools/recap"
          className="inline-flex min-h-11 items-center rounded-xl border border-stealth-600 px-4 text-sm font-semibold text-stealth-200 hover:border-stealth-400 hover:text-stealth-100"
        >
          All recaps
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)] xl:gap-6">
        <div className="order-1 min-w-0 xl:order-2">
          <UpdatesViewer
            post={post || null}
            loading={postLoading}
            error={postError}
            onOpenChart={openChart}
          />
        </div>

        <aside
          className="order-2 min-w-0 xl:order-1 xl:sticky xl:top-20 xl:self-start"
          aria-label="Related recap navigation"
        >
          <button
            type="button"
            aria-expanded={recentOpen}
            aria-controls="recent-recap-posts"
            onClick={() => setRecentOpen((previous) => !previous)}
            className="flex min-h-11 w-full items-center justify-between rounded-xl border border-stealth-600 px-4 text-left text-sm font-semibold text-stealth-100 xl:hidden"
          >
            <span>Recent recaps</span>
            <span aria-hidden="true">{recentOpen ? "−" : "+"}</span>
          </button>
          <div
            id="recent-recap-posts"
            className={`${recentOpen ? "mt-3 block" : "hidden"} xl:mt-0 xl:block`}
          >
            {recentPosts.length > 0 ? (
              <UpdatesList
                posts={recentPosts}
                selectedId={post?.id ?? null}
                onSelect={handleSelectRecent}
              />
            ) : (
              <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 p-6 text-sm text-stealth-300">
                No recent recap posts found.
              </div>
            )}
          </div>
        </aside>
      </div>

      <ChartGallery
        isOpen={galleryOpen}
        urls={post?.chart_urls ?? []}
        initialIndex={activeChartIndex}
        title={post?.title ?? "Recap charts"}
        onClose={closeGallery}
      />
    </div>
  );
}
