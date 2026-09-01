import { useMemo, useState } from "react";

import DataScroller from "../../components/ui/DataScroller";
import { BLS_OVERVIEW_RULE_RECEIPT } from "./blsOverviewModel";
import {
  dataQualityStatus,
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

const GLOSSARY = [
  { term: "Reference period", definition: "The month or interval measured by an observation. It is the horizontal axis for trend views." },
  { term: "Estimate vintage", definition: "A first, second, or third payroll estimate for the same reference month." },
  { term: "Scheduled release time", definition: "The planned publication clock. It does not confirm publication or establish observation lineage." },
  { term: "Primary measure", definition: "The analytical value shown in charts, such as year-over-year percent change, monthly payroll change, or a published rate." },
  { term: "Relative percentile", definition: "A measure’s position from 0–100 against its own trailing five-year history. It is not a cross-series unit conversion." },
  { term: "Observed revision", definition: "The difference between a value first seen by this dashboard and its current observed BLS value." },
  { term: "Preliminary", definition: "A BLS observation or estimate that remains eligible for a later scheduled estimate stage." },
];

const RULE_LABELS: Record<keyof typeof BLS_OVERVIEW_RULE_RECEIPT.series, string> = {
  CES0000000001: "Payroll growth",
  LNS14000000: "Unemployment rate",
  CES0500000003: "Hourly earnings growth",
  JTS000000000000000JOR: "Job openings rate",
  JTS000000000000000JOL: "Job openings level fallback",
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
  const [query, setQuery] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const normalizedQuery = query.trim().toLowerCase();
  const methodology = Array.isArray(data.methodology)
    ? data.methodology.map((value, index) => [`method_${index + 1}`, value] as const)
    : Object.entries(data.methodology);
  const coverage = typeof data.coverage === "string"
    ? [["coverage", data.coverage] as const]
    : Object.entries(data.coverage);
  const filteredGlossary = GLOSSARY.filter(({ term, definition }) => (
    !normalizedQuery || `${term} ${definition}`.toLowerCase().includes(normalizedQuery)
  ));
  const filteredSeries = data.series.filter((series) => (
    !normalizedQuery
    || `${series.label} ${series.short_label} ${series.series_id} ${series.report_id} ${series.primary_measure}`.toLowerCase().includes(normalizedQuery)
  ));
  const observationExceptions = data.series.flatMap((series) => series.observations
    .filter((observation) => {
      const hasFootnotes = typeof observation.footnotes === "string"
        ? observation.footnotes.trim().length > 0
        : Boolean(observation.footnotes?.length);
      return observation.preliminary || observation.revision_count > 0 || hasFootnotes;
    })
    .map((observation) => ({ series, observation })));
  const sourceExport = useMemo(() => JSON.stringify({
    assembled_at: data.as_of,
    reports: data.reports.map((report) => ({ id: reportId(report), label: reportLabel(report), source_url: report.source_url ?? null })),
    series: data.series.map((series) => ({ series_id: series.series_id, report_id: series.report_id, label: series.label, source_url: series.source_url })),
  }, null, 2), [data]);
  const downloadHref = `data:application/json;charset=utf-8,${encodeURIComponent(sourceExport)}`;

  async function copySourceIds() {
    try {
      await navigator.clipboard.writeText(data.series.map((series) => series.series_id).join("\n"));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <section id="bls-methods" className="bls-audit section-anchor" aria-labelledby="bls-methods-title">
      <header className="bls-section-header">
        <div>
          <p className="bls-section-kicker">Methods & sources</p>
          <h2 id="bls-methods-title">How the evidence is built</h2>
          <p>Definitions, coverage, vintage rules, limitations, and official identifiers live here so the analytical views can stay focused.</p>
        </div>
        <span className="bls-clock-label">Response assembled · {formatDateTime(data.as_of)}</span>
      </header>

      <dl className="bls-methods-status" aria-label="BLS source status">
        <div><dt>Source status</dt><dd>{dataQualityStatus(data.data_quality)}</dd></div>
        <div><dt>Series returned</dt><dd>{data.series.length}</dd></div>
        <div><dt>Requested history</dt><dd>{data.requested_years} years</dd></div>
        <div><dt>Known notes</dt><dd>{data.warnings.length}</dd></div>
      </dl>

      <label className="bls-method-search">
        <span>Search glossary and source mappings</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Try “vintage”, “CPI”, or a series ID" />
      </label>

      <div className="bls-method-grid">
        <section aria-labelledby="bls-glossary-title">
          <h3 id="bls-glossary-title">Glossary</h3>
          {filteredGlossary.length > 0 ? (
            <dl className="bls-definition-list">
              {filteredGlossary.map(({ term, definition }) => (
                <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>
              ))}
            </dl>
          ) : <p className="bls-empty-copy">No glossary term matches “{query}”.</p>}
        </section>
        <section aria-labelledby="bls-report-sources-title">
          <h3 id="bls-report-sources-title">Official report sources</h3>
          <ul className="bls-source-list">
            {data.reports.map((report) => (
              <li key={reportId(report)}>
                <span><strong>{reportLabel(report)}</strong><small>{reportId(report)}</small></span>
                {report.source_url ? <a href={report.source_url} target="_blank" rel="noreferrer">BLS source</a> : <span>Source unavailable</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {data.warnings.length > 0 ? (
        <section className="bls-limitations" aria-labelledby="bls-limitations-title">
          <h3 id="bls-limitations-title">Known limitations</h3>
          <ul>{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </section>
      ) : null}

      <div className="bls-method-disclosures">
        <details>
          <summary>Calculation rules and coverage receipt</summary>
          <section className="bls-rule-method" aria-labelledby="bls-rule-method-title">
            <h3 id="bls-rule-method-title">Dashboard labor-direction rule</h3>
            <p>This dashboard compares each eligible series’ latest three-month primary-value mean with its prior three-month mean. It requires six contiguous finite months and rounds the difference to three decimals before applying these inclusive materiality bands:</p>
            <ul>
              {Object.entries(BLS_OVERVIEW_RULE_RECEIPT.series).map(([seriesId, rule]) => (
                <li key={seriesId}><strong>{RULE_LABELS[seriesId as keyof typeof RULE_LABELS]}:</strong> {formatValue(rule.band, 2)} {rule.bandUnit}.</li>
              ))}
            </ul>
            <p>The overall label votes only payroll, unemployment with inverse polarity, and job openings rate—or openings level when the rate is unavailable. It requires at least {BLS_OVERVIEW_RULE_RECEIPT.overall.minimumEligibleVoters} eligible voters and excludes a voter more than {BLS_OVERVIEW_RULE_RECEIPT.overall.maximumAnchorLagMonths} months behind the freshest anchor. Hourly earnings and payroll revisions do not vote. These are transparent dashboard rules, not BLS, recession, or policy classifications.</p>
          </section>
          <div className="bls-disclosure-grid">
            <section>
              <h3>Coverage</h3>
              <dl className="bls-definition-list">
                {coverage.map(([key, value]) => <div key={key}><dt>{key.replace(/_/g, " ")}</dt><dd>{printable(value)}</dd></div>)}
              </dl>
            </section>
            <section>
              <h3>Methodology</h3>
              <dl className="bls-definition-list">
                {methodology.map(([key, value]) => <div key={key}><dt>{key.replace(/_/g, " ")}</dt><dd>{printable(value)}</dd></div>)}
              </dl>
            </section>
          </div>
        </details>

        <details>
          <summary>Vintage and footnote exceptions · {observationExceptions.length}</summary>
          <p>This ledger contains preliminary observations, tracked value changes, and BLS footnotes. Tracking timestamps describe this dashboard’s observations, not original publication times.</p>
          {observationExceptions.length > 0 ? (
            <DataScroller label="BLS observation vintage and footnote exceptions" className="bls-observation-scroller" hint="Scroll horizontally or vertically to inspect every returned exception.">
              <table className="bls-table bls-observation-table">
                <caption className="sr-only">Preliminary, revised, and footnoted BLS observations</caption>
                <thead><tr><th scope="col">Series</th><th scope="col">Reference period</th><th scope="col">Raw published</th><th scope="col">First seen</th><th scope="col">Current</th><th scope="col">Observed revision</th><th scope="col">State</th><th scope="col">Tracking timestamp</th><th scope="col">BLS footnotes</th></tr></thead>
                <tbody>
                  {observationExceptions.map(({ series, observation }) => {
                    const rawUnit = series.raw_unit ?? series.unit ?? "native units";
                    return (
                      <tr key={`${series.series_id}-${observation.period}`}>
                        <th scope="row">{series.short_label}<span>{series.series_id}</span></th>
                        <td>{formatPeriod(observation.period)}</td>
                        <td>{formatValue(observation.raw_value, 3)} {observation.raw_value === null ? "" : rawUnit}</td>
                        <td>{formatValue(observation.first_seen_value, 3)} {observation.first_seen_value === null ? "" : rawUnit}</td>
                        <td>{formatValue(observation.current_value, 3)} {observation.current_value === null ? "" : rawUnit}</td>
                        <td>{formatSigned(observation.revision_delta, "", 3)} {observation.revision_delta === null ? "" : rawUnit}</td>
                        <td>{observation.preliminary ? "Preliminary" : `${observation.revision_count} tracked revision${observation.revision_count === 1 ? "" : "s"}`}</td>
                        <td>{observation.last_seen_at ? formatDateTime(observation.last_seen_at) : "Unavailable"}</td>
                        <td>{formatFootnotes(observation.footnotes)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataScroller>
          ) : <p className="bls-empty-copy">No preliminary, revised, or footnoted observation is present.</p>}
        </details>

        <details>
          <summary>Series coverage and source mappings · {filteredSeries.length}</summary>
          <div className="bls-source-actions">
            <button type="button" className="field-button field-button-secondary" onClick={copySourceIds}>Copy source IDs</button>
            <a className="field-button field-button-secondary" href={downloadHref} download="bls-source-map.json">Download source map</a>
            <span role="status">{copyState === "copied" ? "Source IDs copied." : copyState === "error" ? "Copy failed; use the download instead." : ""}</span>
          </div>
          {filteredSeries.length > 0 ? (
            <DataScroller label="BLS series source and coverage audit">
              <table className="bls-table bls-audit-table">
                <caption className="sr-only">BLS series identifiers, measures, coverage, and sources</caption>
                <thead><tr><th scope="col">Series</th><th scope="col">BLS series ID</th><th scope="col">Report ID</th><th scope="col">Adjustment</th><th scope="col">Primary measure</th><th scope="col">Coverage</th><th scope="col">Source</th></tr></thead>
                <tbody>
                  {filteredSeries.map((series) => {
                    const start = seriesCoverageStart(series);
                    const end = seriesCoverageEnd(series);
                    return (
                      <tr key={series.series_id}>
                        <th scope="row">{series.label}</th><td><code>{series.series_id}</code></td><td><code>{series.report_id}</code></td><td>{series.seasonal_adjustment}</td><td>{series.primary_measure} · {series.primary_unit}</td><td>{start ? formatPeriod(start) : "Unavailable"} – {end ? formatPeriod(end) : "Unavailable"}</td><td><a href={series.source_url} target="_blank" rel="noreferrer">Series source</a></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataScroller>
          ) : <p className="bls-empty-copy">No source mapping matches “{query}”.</p>}
        </details>
      </div>
    </section>
  );
}
