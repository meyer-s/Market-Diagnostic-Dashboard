import DataScroller from "../../components/ui/DataScroller";
import {
  calendarLabel,
  clockTime,
  formatDate,
  formatPeriod,
  formatSigned,
  formatValue,
  latestObservation,
  reportId,
  reportLabel,
  seriesHasPrimaryData,
} from "./format";
import type { BlsLensResponse, BlsReport } from "./types";

type ReleaseOverviewProps = {
  data: BlsLensResponse;
};

function latestScheduledEvent(data: BlsLensResponse, id: string) {
  const asOf = new Date(data.as_of).getTime();
  return [...data.release_calendar]
    .filter((entry) => entry.report_id === id && new Date(entry.scheduled_at).getTime() <= asOf)
    .sort((left, right) => right.scheduled_at.localeCompare(left.scheduled_at))[0];
}

function reportSeries(data: BlsLensResponse, report: BlsReport) {
  const ids = new Set(report.series_ids ?? []);
  return data.series.filter(
    (series) => series.report_id === reportId(report) || ids.has(series.series_id),
  );
}

export default function ReleaseOverview({ data }: ReleaseOverviewProps) {
  const asOf = new Date(data.as_of).getTime();
  const upcoming = [...data.release_calendar]
    .filter((entry) => new Date(entry.scheduled_at).getTime() > asOf)
    .sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at))
    .slice(0, 4);

  return (
    <section id="bls-now" className="bls-ledger section-anchor" aria-labelledby="bls-now-title">
      <header className="bls-section-header">
        <div>
          <p className="bls-section-kicker">Now</p>
          <h2 id="bls-now-title">Current release ledger</h2>
          <p>Each row keeps the latest observation separate from the latest past scheduled event. Calendar timing does not confirm or identify that observation’s release.</p>
        </div>
        <span className="bls-clock-label">Observation clock · reference period</span>
      </header>

      <div className="bls-now-grid">
        <DataScroller
          label="Latest BLS observations by report"
          hint="Scroll horizontally to compare observations with the latest past scheduled calendar events."
        >
          <table className="bls-table bls-current-table">
            <thead>
              <tr>
                <th scope="col">Report</th>
                <th scope="col">Reference period</th>
                <th scope="col">Latest reading</th>
                <th scope="col">Raw 1m change</th>
                <th scope="col">Latest scheduled event</th>
              </tr>
            </thead>
            <tbody>
              {data.reports.map((report) => {
                const series = reportSeries(data, report);
                const primary = series.find(seriesHasPrimaryData) ?? series[0];
                const observation = primary ? latestObservation(primary) : null;
                const scheduledEvent = latestScheduledEvent(data, reportId(report));
                return (
                  <tr key={reportId(report)}>
                    <th scope="row">
                      {report.source_url ? (
                        <a href={report.source_url} target="_blank" rel="noreferrer">
                          {reportLabel(report)}
                        </a>
                      ) : reportLabel(report)}
                      <span>{primary?.short_label ?? `${series.length} tracked series`}</span>
                    </th>
                    <td>{observation ? formatPeriod(observation.period) : "Unavailable"}</td>
                    <td>
                      {observation ? formatValue(observation.primary_value) : "Unavailable"}
                      {primary?.primary_unit ? <span>{primary.primary_unit}</span> : null}
                      {observation?.preliminary ? <em>Preliminary</em> : null}
                    </td>
                    <td>
                      {observation ? formatSigned(observation.change_1m) : "Unavailable"}
                      {observation?.change_1m !== null && primary?.change_1m_unit ? (
                        <span>{primary.change_1m_unit}</span>
                      ) : null}
                    </td>
                    <td>{scheduledEvent ? formatDate(scheduledEvent.scheduled_at) : "No past scheduled event"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataScroller>

        <aside className="bls-runway" aria-labelledby="bls-runway-title">
          <div>
            <p className="bls-section-kicker">Next</p>
            <h3 id="bls-runway-title">Release runway</h3>
            <p className="bls-runway-note">Scheduled release time · U.S. Eastern</p>
          </div>
          {upcoming.length > 0 ? (
            <ol>
              {upcoming.map((entry, index) => (
                <li key={`${entry.report_id}-${entry.scheduled_at}`}>
                  <span className="bls-runway-order">{String(index + 1).padStart(2, "0")}</span>
                  <span className="bls-runway-copy">
                    <strong>{calendarLabel(entry)}</strong>
                    <span>{formatDate(entry.scheduled_at)} · {clockTime(entry)}</span>
                  </span>
                  <span className="bls-status-label">Scheduled</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="bls-empty-copy">No future scheduled event is present in the returned calendar.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
