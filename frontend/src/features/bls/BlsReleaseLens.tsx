/*
THESIS: The Overview explains; detailed views prove; Methods documents.
OWN-WORLD: Evidence Field in an answer-first labor brief, quiet rows, native-unit small multiples, exact ledgers, and explicit clock labels.
STORY: Orient to the current labor read, then enter one releases, trends, revisions, calendar, or methods workspace without carrying a long document in memory.
FIRST VIEWPORT: A compact source receipt leads directly to the Overview decision brief and headline observations.
FORM: Operate-mode progressive disclosure with six query-addressable views and one stable tab panel.
*/

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import EvidenceStateNotice from "../../components/ui/EvidenceStateNotice";
import PageState from "../../components/ui/PageState";
import { useApi } from "../../hooks/useApi";
import type { EvidenceState } from "../../utils/evidenceState";
import AuditPanel from "./AuditPanel";
import BlsOverview from "./BlsOverview";
import type { BlsOverviewTarget } from "./blsOverviewModel";
import BlsViewTabs, { isBlsView, type BlsView } from "./BlsViewTabs";
import {
  dataQualityMessage,
  dataQualityStatus,
  defaultSeriesIds,
  formatDateTime,
  seriesHasPrimaryData,
} from "./format";
import NativeTrend from "./NativeTrend";
import RelativeField from "./RelativeField";
import ReleaseCalendar from "./ReleaseCalendar";
import ReleaseOverview from "./ReleaseOverview";
import RevisionLedger from "./RevisionLedger";
import type { BlsLensResponse } from "./types";
import "./bls.css";

const LEGACY_HASH_TARGETS: Record<string, { view: BlsView; anchorId: string }> = {
  "#bls-now": { view: "overview", anchorId: "bls-overview-title" },
  "#bls-relative": { view: "trends", anchorId: "bls-relative" },
  "#bls-native": { view: "trends", anchorId: "bls-native" },
  "#bls-revisions": { view: "revisions", anchorId: "bls-revisions" },
  "#bls-calendar": { view: "calendar", anchorId: "bls-calendar" },
  "#bls-audit": { view: "methods", anchorId: "bls-methods" },
};

type TrendMode = "native" | "relative";

function isTrendMode(value: string | null): value is TrendMode {
  return value === "native" || value === "relative";
}

function evidenceState(status: string): EvidenceState {
  const normalized = status.toLowerCase();
  if (normalized === "complete") return "complete";
  if (normalized === "stale") return "stale";
  if (normalized === "empty") return "empty";
  if (normalized === "error" || normalized === "unavailable") return "error";
  return "partial";
}

function preferredTrendIds(data: BlsLensResponse | null): string[] {
  if (!data) return [];
  const usable = data.series.filter(seriesHasPrimaryData);
  const preferred = ["CES0000000001", "LNS14000000"]
    .filter((id) => usable.some((series) => series.series_id === id));
  return [...new Set([...preferred, ...defaultSeriesIds(usable, 2)])].slice(0, 2);
}

export default function BlsReleaseLens() {
  const { data, loading, error, refetch } = useApi<BlsLensResponse>(
    "/bls/lens?years=10",
    { timeoutMs: 60_000 },
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [legacyHash, setLegacyHash] = useState(() => window.location.hash);
  const handledLegacyHash = useRef<string | null>(null);
  const pendingLegacyTarget = useRef<{ view: BlsView; anchorId: string } | null>(null);
  const queryView = searchParams.get("view");
  const activeView: BlsView = isBlsView(queryView) ? queryView : "overview";
  const queryTrendMode = searchParams.get("trend");
  const activeTrendMode: TrendMode = queryTrendMode === "relative" ? "relative" : "native";
  const requestedSeriesId = searchParams.get("series") ?? "";
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [nativeSeriesId, setNativeSeriesId] = useState("");
  const defaultIds = useMemo(() => preferredTrendIds(data), [data]);

  useEffect(() => {
    const handleHashChange = () => setLegacyHash(window.location.hash);
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (handledLegacyHash.current === legacyHash) return;
    const initialHash = handledLegacyHash.current === null;
    handledLegacyHash.current = legacyHash;
    const target = LEGACY_HASH_TARGETS[legacyHash];
    if (!target || (initialHash && isBlsView(queryView))) return;
    pendingLegacyTarget.current = target;
    const next = new URLSearchParams(searchParams);
    if (target.view === "overview") next.delete("view");
    else next.set("view", target.view);
    if (target.anchorId === "bls-relative") next.set("trend", "relative");
    else next.delete("trend");
    setSearchParams(next, { replace: true });
  }, [legacyHash, queryView, searchParams, setSearchParams]);

  useEffect(() => {
    const invalidView = queryView !== null && !isBlsView(queryView);
    const invalidTrendMode = queryTrendMode !== null && !isTrendMode(queryTrendMode);
    const misplacedTrendMode = queryTrendMode !== null && activeView !== "trends";
    const invalidSeries = Boolean(
      requestedSeriesId
      && data
      && !data.series.some((series) => series.series_id === requestedSeriesId && seriesHasPrimaryData(series)),
    );
    if (!invalidView && !invalidTrendMode && !misplacedTrendMode && !invalidSeries) return;
    const next = new URLSearchParams(searchParams);
    if (invalidView) next.delete("view");
    if (invalidTrendMode || misplacedTrendMode) next.delete("trend");
    if (invalidSeries) next.delete("series");
    setSearchParams(next, { replace: true });
  }, [activeView, data, queryTrendMode, queryView, requestedSeriesId, searchParams, setSearchParams]);

  useEffect(() => {
    const target = pendingLegacyTarget.current;
    if (!data || !target || target.view !== activeView) return;
    const frame = window.requestAnimationFrame(() => {
      const anchor = document.getElementById(target.anchorId);
      const tab = document.getElementById(`bls-tab-${target.view}`);
      if (!anchor || !tab) return;
      anchor.scrollIntoView?.({ block: "start" });
      tab.focus({ preventScroll: true });
      pendingLegacyTarget.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeView, data]);

  useEffect(() => {
    if (!data?.series.length) return;
    const usableSeries = data.series.filter(seriesHasPrimaryData);
    const available = new Set(usableSeries.map((series) => series.series_id));
    setSelectedIds((current) => {
      const valid = current.filter((id) => available.has(id)).slice(0, 2);
      const requested = requestedSeriesId && available.has(requestedSeriesId) ? [requestedSeriesId] : [];
      return [...new Set([...requested, ...valid, ...defaultIds])].slice(0, 2);
    });
    setNativeSeriesId((current) => (
      requestedSeriesId && available.has(requestedSeriesId)
        ? requestedSeriesId
        : available.has(current)
          ? current
          : defaultIds[0] ?? usableSeries[0]?.series_id ?? ""
    ));
  }, [data?.series, defaultIds, requestedSeriesId]);

  function updateView(view: BlsView, seriesId?: string, focusDestination = false) {
    const next = new URLSearchParams(searchParams);
    if (view === "overview") next.delete("view");
    else next.set("view", view);
    if (view !== "trends" || activeView !== "trends") next.delete("trend");
    if (seriesId) next.set("series", seriesId);
    setSearchParams(next);
    if (focusDestination) {
      window.requestAnimationFrame(() => document.getElementById(`bls-tab-${view}`)?.focus());
    }
  }

  function openDetail(target: BlsOverviewTarget, seriesId?: string) {
    const usableSeriesId = seriesId && data?.series.some((series) => series.series_id === seriesId && seriesHasPrimaryData(series))
      ? seriesId
      : undefined;
    if (usableSeriesId) {
      setNativeSeriesId(usableSeriesId);
      setSelectedIds((current) => [usableSeriesId, ...current.filter((id) => id !== usableSeriesId)].slice(0, 2));
    }
    updateView(target, usableSeriesId, true);
  }

  function selectNativeSeries(seriesId: string) {
    setNativeSeriesId(seriesId);
    setSelectedIds((current) => [seriesId, ...current.filter((id) => id !== seriesId)].slice(0, 2));
    const next = new URLSearchParams(searchParams);
    next.set("view", "trends");
    next.delete("trend");
    next.set("series", seriesId);
    setSearchParams(next, { replace: true });
  }

  function setTrendMode(mode: TrendMode) {
    const next = new URLSearchParams(searchParams);
    next.set("view", "trends");
    if (mode === "relative") next.set("trend", "relative");
    else next.delete("trend");
    setSearchParams(next, { replace: true });
  }

  function toggleSeries(seriesId: string) {
    if (!data?.series.some((series) => series.series_id === seriesId && seriesHasPrimaryData(series))) return;
    setSelectedIds((current) => {
      if (current.includes(seriesId)) {
        return current.length === 1 ? current : current.filter((id) => id !== seriesId);
      }
      return current.length >= 2 ? current : [...current, seriesId];
    });
  }

  const header = (
    <header className="bls-compact-header">
      <div className="bls-header-copy">
        <p className="bls-header-kicker">Bureau of Labor Statistics</p>
        <h1>BLS Release Lens</h1>
        <p className="bls-header-status">
          <span>{data ? `Updated ${formatDateTime(data.as_of)} · ${dataQualityStatus(data.data_quality) === "complete" ? "Sources complete" : `${dataQualityStatus(data.data_quality)} source coverage`}` : "Official BLS observations, revisions, and schedules"}</span>
          <button type="button" className="bls-header-refresh" onClick={refetch} disabled={loading}>
            {loading && data ? "Refreshing…" : "Refresh"}
          </button>
        </p>
      </div>
    </header>
  );

  if (loading && !data) {
    return (
      <div className="page-shell-wide page-stack bls-page">
        {header}
        <PageState variant="loading" headingLevel={2} title="Loading the BLS release lens" message="Retrieving official observations, estimate vintages, and scheduled publication times." />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-shell-wide page-stack bls-page">
        {header}
        <PageState variant="error" headingLevel={2} title="BLS evidence is unavailable" message={error ?? "The response did not contain BLS release evidence. Try again."} actions={<button type="button" className="field-button field-button-primary" onClick={refetch}>Try again</button>} />
      </div>
    );
  }

  if (data.series.length === 0) {
    return (
      <div className="page-shell-wide page-stack bls-page">
        {header}
        <PageState variant="empty" headingLevel={2} title="No BLS series were returned" message="The release receipt is available, but there are no observations to compare yet." actions={<button type="button" className="field-button field-button-primary" onClick={refetch}>Refresh data</button>} />
      </div>
    );
  }

  const qualityStatus = dataQualityStatus(data.data_quality);
  const qualityState = evidenceState(qualityStatus);
  const qualityMessage = error
    ? "The newest refresh failed. The retained response remains visible and may be stale."
    : dataQualityMessage(data.data_quality)
      ?? "Some expected BLS evidence is incomplete; available observations remain visible.";

  return (
    <div className="page-shell-wide bls-page">
      {header}
      <BlsViewTabs activeView={activeView} onChange={(view) => updateView(view)} />

      {(qualityState !== "complete" || error) ? (
        <EvidenceStateNotice
          panelId="bls-lens"
          title="BLS source status"
          state={error ? "stale" : qualityState}
          message={qualityMessage}
          details={data.warnings.length > 0 ? (
            <details className="bls-source-notes">
              <summary>View {data.warnings.length} source note{data.warnings.length === 1 ? "" : "s"}</summary>
              <ul className="bls-warning-list">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </details>
          ) : undefined}
        />
      ) : null}

      <section
        id="bls-active-panel"
        role="tabpanel"
        aria-labelledby={`bls-tab-${activeView}`}
        tabIndex={0}
        className="bls-active-panel"
      >
        {activeView === "overview" ? <BlsOverview data={data} onNavigate={openDetail} /> : null}
        {activeView === "releases" ? <ReleaseOverview data={data} onOpenTrend={(seriesId) => openDetail("trends", seriesId)} /> : null}
        {activeView === "trends" ? (
          <div className="bls-trends-workspace">
            <div className="bls-trend-mode" role="group" aria-label="Trend workspace">
              <button type="button" aria-pressed={activeTrendMode === "native"} onClick={() => setTrendMode("native")}>Native trend</button>
              <button type="button" aria-pressed={activeTrendMode === "relative"} onClick={() => setTrendMode("relative")}>Relative comparison</button>
            </div>
            {activeTrendMode === "native"
              ? <NativeTrend series={data.series} selectedId={nativeSeriesId} onSelect={selectNativeSeries} />
              : <RelativeField series={data.series} selectedIds={selectedIds} onToggle={toggleSeries} />}
          </div>
        ) : null}
        {activeView === "revisions" ? <RevisionLedger revisions={data.payroll_revisions} /> : null}
        {activeView === "calendar" ? <ReleaseCalendar entries={data.release_calendar} asOf={data.as_of} /> : null}
        {activeView === "methods" ? <AuditPanel data={data} /> : null}
      </section>
    </div>
  );
}
