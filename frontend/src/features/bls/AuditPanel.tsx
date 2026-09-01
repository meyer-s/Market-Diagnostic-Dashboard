import DataScroller from "../../components/ui/DataScroller";
import {
  formatDateTime,
  formatFootnotes,
  formatPeriod,
  formatSigned,
  formatValue,
  reportId,
  reportLabel,
  seriesCoverageEnd,
  seriesCoverageStart,
} from "./format";
import type { BlsLensResponse } from "./types";

type AuditPanelProps = {
  data: BlsLensResponse;
};

function printable(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "Unavailable";
  if (Array.isArray(value)) return value.map(printable).join(" · ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key.replace(/_/g, " ")}: ${printable(item)}`)
      .join(" · ");
  }
  return String(value);
}

export default function AuditPanel({ data }: AuditPanelProps) {
  const methodology = Array.isArray(data.methodology)
    ? data.methodology.map((value, index) => [`method_${index + 1}`, value] as const)
    : Object.entries(data.methodology);
  const coverage = typeof data.coverage === "string"
    ? [["coverage", data.coverage] as const]
    : Object.entries(data.coverage);
  const observationExceptions = data.series.flatMap((series) => series.observations
    .filter((observation) => {
      const hasFootnotes = typeof observation.footnotes === "string"
        ? observation.footnotes.trim().length > 0
        : Boolean(observation.footnotes?.length);
      return observation.preliminary || observation.revision_count > 0 || hasFootnotes;
    })
    .map((observation) => ({ series, observation })));

  return (
    <section id="bls-audit" className="bls-audit section-anchor" aria-labelledby="bls-audit-title">
      <header className="bls-section-header">
        <div>
          <p className="bls-section-kicker">Audit</p>
          <h2 id="bls-audit-title">Definitions, coverage, and source IDs</h2>
          <p>The receipt keeps transformations and provenance adjacent to the visuals they qualify.</p>
        </div>
        <span className="bls-clock-label">Response assembled · {formatDateTime(data.as_of)}</span>
      </header>

      <div className="bls-clock-definitions" aria-label="Three BLS time clocks">
        <article>
          <h3>Reference period</h3>
          <p>The month or interval measured by an observation. This is the horizontal axis for Relative and Native views.</p>
        </article>
        <article>
          <h3>Estimate vintage</h3>
          <p>The first, second, or third published estimate for the same payroll reference month.</p>
        </article>
        <article>
          <h3>Scheduled release time</h3>
          <p>The planned calendar date and time. It orders the schedule rail but does not confirm a release or establish observation lineage.</p>
        </article>
      </div>

      <div className="bls-method-grid">
        <div>
          <h3>Coverage receipt</h3>
          <dl className="bls-definition-list">
            <div>
              <dt>requested years</dt>
              <dd>{data.requested_years}</dd>
            </div>
            {coverage.map(([key, value]) => (
              <div key={key}>
                <dt>{key.replace(/_/g, " ")}</dt>
                <dd>{printable(value)}</dd>
              </div>
            ))}
          </dl>
          <h3 className="bls-audit-subheading">Methodology</h3>
          <dl className="bls-definition-list">
            {methodology.map(([key, value]) => (
              <div key={key}>
                <dt>{key.replace(/_/g, " ")}</dt>
                <dd>{printable(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h3>Report sources</h3>
          <ul className="bls-source-list">
            {data.reports.map((report) => (
              <li key={reportId(report)}>
                <span><strong>{reportLabel(report)}</strong><small>{reportId(report)}</small></span>
                {report.source_url ? <a href={report.source_url} target="_blank" rel="noreferrer">BLS source</a> : <span>Source unavailable</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="bls-observation-audit">
        <h3>Observation vintage and footnote exceptions</h3>
        <p>
          This ledger surfaces preliminary observations, tracked value changes, and BLS footnotes across every series. The Native chart’s data disclosure carries the same raw, first-seen, current, and revision fields for every observation in the selected series.
        </p>
        {observationExceptions.length > 0 ? (
          <DataScroller
            label="BLS observation vintage and footnote exceptions"
            className="bls-observation-scroller"
            hint="Scroll horizontally or vertically to inspect every returned observation exception."
          >
            <table className="bls-table bls-observation-table">
              <thead>
                <tr>
                  <th scope="col">Series</th>
                  <th scope="col">Reference period</th>
                  <th scope="col">Raw published</th>
                  <th scope="col">First seen</th>
                  <th scope="col">Current</th>
                  <th scope="col">Observed revision</th>
                  <th scope="col">State</th>
                  <th scope="col">Tracking timestamp</th>
                  <th scope="col">BLS footnotes</th>
                </tr>
              </thead>
              <tbody>
                {observationExceptions.map(({ series, observation }) => {
                  const rawUnit = series.raw_unit ?? series.unit ?? "native units";
                  return (
                    <tr key={`${series.series_id}-${observation.period}`}>
                      <th scope="row">{series.short_label}<span>{series.series_id}</span></th>
                      <td>{formatPeriod(observation.period)}</td>
                      <td>{formatValue(observation.raw_value)} {observation.raw_value === null ? "" : rawUnit}</td>
                      <td>{formatValue(observation.first_seen_value)} {observation.first_seen_value === null ? "" : rawUnit}</td>
                      <td>{formatValue(observation.current_value)} {observation.current_value === null ? "" : rawUnit}</td>
                      <td>{formatSigned(observation.revision_delta)} {observation.revision_delta === null ? "" : rawUnit}</td>
                      <td>{observation.preliminary ? "Preliminary" : `${observation.revision_count} tracked revision${observation.revision_count === 1 ? "" : "s"}`}</td>
                      <td>{observation.last_seen_at ? formatDateTime(observation.last_seen_at) : "Unavailable"}</td>
                      <td>{formatFootnotes(observation.footnotes)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataScroller>
        ) : (
          <p className="bls-empty-copy">No preliminary, revised, or footnoted observation is present in this response.</p>
        )}
      </div>

      <DataScroller label="BLS series source and coverage audit">
        <table className="bls-table bls-audit-table">
          <thead>
            <tr>
              <th scope="col">Series</th>
              <th scope="col">BLS series ID</th>
              <th scope="col">Report ID</th>
              <th scope="col">Adjustment</th>
              <th scope="col">Primary measure</th>
              <th scope="col">Coverage</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {data.series.map((series) => {
              const start = seriesCoverageStart(series);
              const end = seriesCoverageEnd(series);
              return (
                <tr key={series.series_id}>
                  <th scope="row">{series.label}</th>
                  <td><code>{series.series_id}</code></td>
                  <td><code>{series.report_id}</code></td>
                  <td>{series.seasonal_adjustment}</td>
                  <td>{series.primary_measure} · {series.primary_unit}</td>
                  <td>{start ? formatPeriod(start) : "Unavailable"} – {end ? formatPeriod(end) : "Unavailable"}</td>
                  <td><a href={series.source_url} target="_blank" rel="noreferrer">Series source</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DataScroller>
    </section>
  );
}
