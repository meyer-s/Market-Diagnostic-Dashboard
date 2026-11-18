import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import UpdatesList from "../updates/UpdatesList";
import { useApi } from "../../hooks/useApi";
import type { UpdatePostDetail, UpdatePostListItem } from "../../types/updates";

const UpdatesViewer = lazy(() => import("../updates/UpdatesViewer"));
const ChartGallery = lazy(() => import("../updates/ChartGallery"));

export default function DashboardRecaps() {
  const history = useApi<UpdatePostListItem[]>("/updates?limit=8&offset=0");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const posts = useMemo(
    () => [...(history.data ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [history.data],
  );
  const selected = posts.find((post) => post.id === selectedId) ?? posts[0];
  const detail = useApi<UpdatePostDetail>(
    selected ? `/updates/by-slug/${encodeURIComponent(selected.slug)}` : "",
    { retainPreviousData: false },
  );
  const post = detail.data?.slug === selected?.slug ? detail.data : null;
  const closeGallery = useCallback(() => setGalleryIndex(null), []);

  return (
    <section id="dashboard-recaps" className="surface-card-strong p-4" aria-labelledby="dashboard-recaps-heading">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="dashboard-recaps-heading" className="text-base font-semibold text-stealth-100">Market recaps</h2>
        <Link to="/tools/recap" className="field-button field-button-secondary">All recaps</Link>
      </div>
      {history.loading ? (
        <p className="py-6 text-sm text-stealth-300" role="status">Loading recap history…</p>
      ) : history.error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="text-sm text-stealth-300" role="status">Recap history is temporarily unavailable.</p>
          <button type="button" className="field-button field-button-secondary" onClick={history.refetch}>Retry recaps</button>
        </div>
      ) : !selected ? (
        <p className="py-6 text-sm text-stealth-300">No published recaps yet.</p>
      ) : (
        <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:grid-cols-[minmax(240px,1fr)_minmax(0,3fr)]">
          <UpdatesList
            compact
            posts={posts}
            selectedId={selected.id}
            onSelect={(id) => { setGalleryIndex(null); setSelectedId(id); }}
          />
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-end gap-3">
              {detail.error && <button type="button" className="text-sm font-semibold text-sky-200 underline underline-offset-4" onClick={detail.refetch}>Retry recap</button>}
              <Link className="text-sm font-semibold text-sky-200 underline underline-offset-4" to={`/tools/recap/${selected.slug}`}>Open full recap</Link>
            </div>
            <div
              key={selected.id}
              className="data-scroller max-h-96 min-w-0 overflow-y-auto rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              role="region"
              aria-label="Selected recap"
              aria-busy={detail.loading}
              tabIndex={0}
            >
              <Suspense fallback={<p className="p-4 text-sm text-stealth-300" role="status">Opening recap…</p>}>
                <UpdatesViewer
                  compact
                  post={post}
                  loading={detail.loading || (!post && !detail.error)}
                  error={detail.error}
                  onOpenChart={setGalleryIndex}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}
      {galleryIndex !== null && post && (
        <Suspense fallback={<p className="mt-3 text-sm text-stealth-300" role="status">Opening charts…</p>}>
          <ChartGallery isOpen urls={post.chart_urls} initialIndex={galleryIndex} title={post.title} onClose={closeGallery} />
        </Suspense>
      )}
    </section>
  );
}
