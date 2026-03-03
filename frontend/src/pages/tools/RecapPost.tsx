import { useEffect, useMemo, useState } from "react";
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

  const openChart = (index: number) => {
    setActiveChartIndex(index);
    setGalleryOpen(true);
  };

  const handleSelectRecent = (id: string) => {
    const target = recentPosts.find((item) => item.id === id);
    if (!target) {
      return;
    }
    navigate(`/tools/recap/${target.slug}`);
  };

  return (
    <div className="space-y-4 p-4 text-stealth-100 md:space-y-6 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stealth-100">Recap Post</h1>
          <p className="mt-1 text-sm text-stealth-400">Direct permalink view for this recap entry.</p>
        </div>
        <Link
          to="/tools/recap"
          className="rounded-xl border border-stealth-600 px-3 py-2 text-xs font-semibold text-stealth-200 hover:border-stealth-500 hover:text-stealth-100"
        >
          Back to All Posts
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)] xl:gap-6">
        <div className="xl:sticky xl:top-20 xl:self-start">
          {recentPosts.length > 0 ? (
            <UpdatesList
              posts={recentPosts}
              selectedId={post?.id ?? null}
              onSelect={handleSelectRecent}
            />
          ) : (
            <div className="rounded-2xl border border-stealth-700 bg-stealth-800/90 p-6 text-sm text-stealth-400">
              No recent recap posts found.
            </div>
          )}
        </div>

        <UpdatesViewer
          post={post || null}
          loading={postLoading}
          error={postError}
          onOpenChart={openChart}
        />
      </div>

      <ChartGallery
        isOpen={galleryOpen}
        urls={post?.chart_urls ?? []}
        initialIndex={activeChartIndex}
        onClose={() => setGalleryOpen(false)}
      />
    </div>
  );
}
