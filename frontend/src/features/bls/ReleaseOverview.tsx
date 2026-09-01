import {
  formatPeriod,
  formatSigned,
  formatValue,
  latestObservation,
  primaryDeltaUnit,
  reportId,
  reportLabel,
  seriesHasPrimaryData,
} from "./format";
import type { BlsLensResponse, BlsObservation, BlsReport, BlsSeries } from "./types";

type ReleaseOverviewProps = {
  data: BlsLensResponse;
  onOpenTrend?: (seriesId: string) => void;
};

function reportSeries(data: BlsLensResponse, report: BlsReport) {
  const ids = new Set(report.series_ids ?? []);
  return data.series.filter(
    (series) => series.report_id === reportId(report) || ids.has(series.series_id),
  );
}

function priorObservation(series: BlsSeries, latest: BlsObservation | null) {
  if (!latest) return null;
  const ordered = [...series.observations].sort((left, right) => left.period.localeCompare(right.period));
  const latestIndex = ordered.findIndex((observation) => observation.period === latest.period);
  const prior = latestIndex > 0 ? ordered[latestIndex - 1] : null;
  return prior?.primary_value !== null && prior?.primary_value !== undefined ? prior : null;
}

function directionLabel(delta: number | null) {
  if (delta === null) return "Direction unavailable";
  if (delta > 0) return "Higher than prior";
  if (delta < 0) return "Lower than prior";
  return "Unchanged";
}

export default function ReleaseOverview({ data, onOpenTrend }: ReleaseOverviewProps) {
  return (
    <section id="bls-releases" className="bls-release-workspace" aria-labelledby="bls-releases-title">
      <header className="bls-section-header">
        <div>
          <p className="bls-section-kicker">Releases</p>
          <h2 id="bls-releases-title">Latest observations by report</h2>
          <p>Read each measure in its published analytical unit. Reference periods describe what was measured; they are not publication timestamps.</p>
        </div>
        <span className="bls-clock-label">Observation clock · reference period</span>
      </header>

      <div className="bls-release-groups">
        {data.reports.map((report) => {
          const series = reportSeries(data, report);
          return (
            <article className="bls-release-group" key={reportId(report)}>
              <header>
                <div>
                  <h3>{reportLabel(report)}</h3>
                  {report.description ? <p>{report.description}</p> : null}
                </div>
                {report.source_url ? (
                  <a href={report.source_url} target="_blank" rel="noreferrer">Official report</a>
                ) : null}
              </header>

              {series.length > 0 ? (
                <ul className="bls-release-rows">
                  {series.map((item) => {
                    const trendAvailable = seriesHasPrimaryData(item);
                    const latest = latestObservation(item);
                    const prior = priorObservation(item, latest);
                    const delta = latest?.primary_value !== null && latest?.primary_value !== undefined
                      && prior?.primary_value !== null && prior?.primary_value !== undefined
                      ? latest.primary_value - prior.primary_value
                      : null;
                    return (
                      <li key={item.series_id}>
                        <div className="bls-release-identity">
                          <strong>{item.short_label}</strong>
                          <span>{latest ? formatPeriod(latest.period) : "Reference period unavailable"}</span>
                        </div>
                        <div className="bls-release-value">
                          <span>Current</span>
                          <strong>{latest ? formatValue(latest.primary_value, 3) : "Unavailable"}</strong>
                          <small>{latest?.primary_value === null ? "" : item.primary_unit}</small>
                        </div>
                        <div className="bls-release-change">
                          <span>From adjacent prior observation</span>
                          <strong>{formatSigned(delta, "", 3)}</strong>
                          <small>{delta === null ? "" : primaryDeltaUnit(item)}</small>
                        </div>
                        <div className="bls-release-meaning">
                          <span className="bls-direction-label">{directionLabel(delta)}</span>
                          <p>{item.higher_means}.</p>
                        </div>
                        <div className="bls-release-actions">
                          {onOpenTrend && trendAvailable ? (
                            <button type="button" className="field-button field-button-secondary" onClick={() => onOpenTrend(item.series_id)}>
                              View trend
                            </button>
                          ) : onOpenTrend ? <span className="bls-unavailable-action">Trend unavailable · no primary observations</span> : null}
                          <details>
                            <summary>Technical details</summary>
                            <dl>
                              <div><dt>Series ID</dt><dd><code>{item.series_id}</code></dd></div>
                              <div><dt>Adjustment</dt><dd>{item.seasonal_adjustment}</dd></div>
                              <div><dt>Primary measure</dt><dd>{item.primary_measure}</dd></div>
                              <div><dt>Vintage state</dt><dd>{latest?.preliminary ? "Preliminary" : "Current published observation"}</dd></div>
                            </dl>
                          </details>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="bls-empty-copy">No series were mapped to this report.</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
