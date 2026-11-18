import { useEffect } from "react";
import { useApi } from "../../hooks/useApi";
import { formatDate, formatDateTime, formatValue, formatSigned } from "./format";

type ClaimsReading = { week_ending: string; value: number; change: number; prior_revised: number };
export type WeeklyClaimsData = {
  status: "current" | "stale" | "unavailable";
  released_on?: string;
  checked_at?: string;
  message?: string;
  source_url: string;
  initial_claims?: ClaimsReading;
  continuing_claims?: ClaimsReading;
};

const calendarDate = (date: string) => formatDate(`${date}T12:00:00Z`);

export default function WeeklyClaims({ compact = false }: { compact?: boolean }) {
  const { data, loading, error, refetch } = useApi<WeeklyClaimsData>("/bls/weekly-claims", { timeoutMs: 25_000 });
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) refetch(); }, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [refetch]);
  const readings = [["Initial claims", data?.initial_claims], ["Continuing claims", data?.continuing_claims]] as const;
  const initialChange = data?.initial_claims?.change;
  const continuingChange = data?.continuing_claims?.change;
  const weeklyRead = initialChange === undefined || continuingChange === undefined
    ? "Both weekly readings are needed to compare new filings with ongoing benefit claims."
    : initialChange > 0 && continuingChange > 0
      ? "New filings and ongoing claims both rose. One week does not establish a trend."
      : initialChange < 0 && continuingChange < 0
        ? "New filings and ongoing claims both fell. One week does not establish a trend."
        : initialChange > 0 && continuingChange < 0
          ? "New filings rose while ongoing claims fell. The measures cover different reference weeks."
          : initialChange < 0 && continuingChange > 0
            ? "New filings fell while ongoing claims rose. The measures cover different reference weeks."
            : "The weekly readings do not share a clear direction. Compare both reference weeks before drawing a trend.";
  const values = (
    <dl className="bls-weekly-readings">
      {readings.map(([label, reading]) => reading ? (
        <div key={label}>
          <dt>{label}</dt>
          <dd><strong>{formatValue(reading.value, 0)}</strong><span>{formatSigned(reading.change, "", 0)} vs revised prior week</span></dd>
          <dd className="bls-weekly-period">Week ending {calendarDate(reading.week_ending)}</dd>
        </div>
      ) : null)}
    </dl>
  );
  return (
    <section className={`bls-weekly${compact ? " bls-weekly-compact" : ""}`} aria-labelledby="bls-weekly-title">
      <header className="bls-section-header">
        <div>
          <h2 id="bls-weekly-title">Weekly jobless claims</h2>
          <p>U.S. Department of Labor · {data?.released_on ? `Released ${calendarDate(data.released_on)}` : "Weekly release"}</p>
        </div>
        <a href={data?.source_url ?? "https://www.dol.gov/ui/data.pdf"} target="_blank" rel="noreferrer">DOL report ↗</a>
      </header>
      {loading && !data ? <p role="status">Checking the latest DOL release…</p> : null}
      {error || data?.status === "stale" || data?.status === "unavailable" ? (
        <p className="bls-weekly-notice" role="status">
          {error ? "Weekly claims check failed. Retained figures may be stale." : data?.status === "stale" ? "Stale · showing the last verified DOL release." : data?.message}
          {" "}<button className="bls-header-refresh" type="button" onClick={refetch} disabled={loading}>Retry claims</button>
        </p>
      ) : null}
      {compact && data?.initial_claims ? <p className="bls-weekly-interpretation">{weeklyRead}</p> : null}
      {compact ? <details className="bls-weekly-receipt"><summary>Weekly levels &amp; revised comparisons</summary>{values}</details> : values}
      {data?.initial_claims ? (
        <details className="bls-weekly-receipt">
          <summary>Advance estimates · seasonally adjusted · source details</summary>
          <p>Weekly claims measure unemployment benefit filings. Monthly payrolls and unemployment below come from BLS surveys.</p>
          {data.checked_at ? <p>Source checked {formatDateTime(data.checked_at)}. Changes use DOL’s revised prior-week levels.</p> : null}
        </details>
      ) : null}
    </section>
  );
}
