/*
THESIS: BLS evidence becomes coherent when observation, revision, and publication clocks stay separate; this surface refuses a generic card wall of latest values.
OWN-WORLD: Evidence Field in compact ledgers, measured charts, exact tables, gold price lines, and blue labor lines.
STORY: Read what is current, compare unlike measures relatively, return to native units, inspect revisions, then orient to the release calendar and audit trail.
FIRST VIEWPORT: A concise page heading gives way immediately to a report ledger beside the next-release runway; the analytical sequence remains visible below.
FORM: Operate-mode chronological evidence spine, staged Now → Relative → Native → Revisions → Calendar → Audit.
*/

import { useEffect, useMemo, useState } from "react";

import EvidenceStateNotice from "../../components/ui/EvidenceStateNotice";
import PageHeader from "../../components/ui/PageHeader";
import PageState from "../../components/ui/PageState";
import SectionNav from "../../components/ui/SectionNav";
import { useApi } from "../../hooks/useApi";
import type { EvidenceState } from "../../utils/evidenceState";
import AuditPanel from "./AuditPanel";
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

const SECTIONS = [
  { id: "bls-now", label: "Now" },
  { id: "bls-relative", label: "Relative" },
  { id: "bls-native", label: "Native" },
  { id: "bls-revisions", label: "Revisions" },
  { id: "bls-calendar", label: "Calendar" },
  { id: "bls-audit", label: "Audit" },
];

function evidenceState(status: string): EvidenceState {
  const normalized = status.toLowerCase();
  if (normalized === "complete") return "complete";
  if (normalized === "stale") return "stale";
  if (normalized === "empty") return "empty";
  if (normalized === "error" || normalized === "unavailable") return "error";
  return "partial";
}

export default function BlsReleaseLens() {
  const { data, loading, error, refetch } = useApi<BlsLensResponse>(
    "/bls/lens?years=10",
    { timeoutMs: 60_000 },
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [nativeSeriesId, setNativeSeriesId] = useState("");

  const defaultIds = useMemo(() => defaultSeriesIds(data?.series ?? []), [data?.series]);

  useEffect(() => {
    if (!data?.series.length) return;
    const usableSeries = data.series.filter(seriesHasPrimaryData);
    const available = new Set(usableSeries.map((series) => series.series_id));
    setSelectedIds((current) => {
      const valid = current.filter((id) => available.has(id)).slice(0, 5);
      return valid.length > 0 ? valid : defaultIds;
    });
    setNativeSeriesId((current) => available.has(current) ? current : defaultIds[0] ?? usableSeries[0]?.series_id ?? "");
  }, [data?.series, defaultIds]);

  function toggleSeries(seriesId: string) {
    if (!data?.series.some((series) => series.series_id === seriesId && seriesHasPrimaryData(series))) return;
    setSelectedIds((current) => {
      if (current.includes(seriesId)) {
        return current.length === 1 ? current : current.filter((id) => id !== seriesId);
      }
      return current.length >= 5 ? current : [...current, seriesId];
    });
  }

  const header = (
    <PageHeader
      kicker="Bureau of Labor Statistics"
      title="BLS Release Lens"
      description="Follow what each report measured, how published estimates changed, and when the next release is scheduled—without collapsing three different clocks into one timeline."
      meta={data ? (
        <>
          <span className="page-badge">Assembled {formatDateTime(data.as_of)}</span>
          <span className="page-badge">{data.requested_years}-year request</span>
          <span className="page-badge">Quality · {dataQualityStatus(data.data_quality)}</span>
        </>
      ) : <span className="page-badge">Official BLS series and schedules</span>}
      actions={(
        <button type="button" className="field-button field-button-secondary" onClick={refetch} disabled={loading}>
          {loading && data ? "Refreshing…" : "Refresh BLS data"}
        </button>
      )}
      className="bls-page-header"
    />
  );

  if (loading && !data) {
    return (
      <div className="page-shell-wide page-stack bls-page">
        {header}
        <PageState
          variant="loading"
          headingLevel={2}
          title="Loading the BLS release lens"
          message="Retrieving official observations, estimate vintages, and scheduled publication times."
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-shell-wide page-stack bls-page">
        {header}
        <PageState
          variant="error"
          headingLevel={2}
          title="BLS evidence is unavailable"
          message={error ?? "The response did not contain BLS release evidence. Try again."}
          actions={<button type="button" className="field-button field-button-primary" onClick={refetch}>Try again</button>}
        />
      </div>
    );
  }

  if (data.series.length === 0) {
    return (
      <div className="page-shell-wide page-stack bls-page">
        {header}
        <PageState
          variant="empty"
          headingLevel={2}
          title="No BLS series were returned"
          message="The release receipt is available, but there are no observations to compare yet."
          actions={<button type="button" className="field-button field-button-primary" onClick={refetch}>Refresh data</button>}
        />
      </div>
    );
  }

  const qualityStatus = dataQualityStatus(data.data_quality);
  const qualityState = evidenceState(qualityStatus);
  const qualityMessage = error
    ? "The newest refresh failed. The retained response remains visible and may be stale."
    : dataQualityMessage(data.data_quality)
      ?? (data.warnings.length > 0 ? "The response includes coverage or timing qualifications." : "All returned evidence passed the service's current completeness checks.");

  return (
    <div className="page-shell-wide page-stack bls-page">
      {header}
      <SectionNav items={SECTIONS} label="BLS lens sections" />

      {(qualityState !== "complete" || error || data.warnings.length > 0) ? (
        <EvidenceStateNotice
          panelId="bls-lens"
          title="BLS evidence quality"
          state={error ? "stale" : qualityState}
          message={qualityMessage}
          details={data.warnings.length > 0 ? (
            <ul className="bls-warning-list">
              {data.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : undefined}
        />
      ) : null}

      <ReleaseOverview data={data} />
      <RelativeField series={data.series} selectedIds={selectedIds} onToggle={toggleSeries} />
      <NativeTrend series={data.series} selectedId={nativeSeriesId} onSelect={setNativeSeriesId} />
      <RevisionLedger revisions={data.payroll_revisions} />
      <ReleaseCalendar entries={data.release_calendar} asOf={data.as_of} />
      <AuditPanel data={data} />
    </div>
  );
}
