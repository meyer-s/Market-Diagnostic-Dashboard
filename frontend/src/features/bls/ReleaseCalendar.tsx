import DataScroller from "../../components/ui/DataScroller";
import { calendarLabel, clockTime, formatDate } from "./format";
import type { BlsCalendarEntry } from "./types";

type ReleaseCalendarProps = {
  entries: BlsCalendarEntry[];
  asOf: string;
};

const VISIBLE_EVENTS_PER_PHASE = 12;

function CalendarList({
  entries,
  emptyMessage,
  phase,
}: {
  entries: BlsCalendarEntry[];
  emptyMessage: string;
  phase: "upcoming" | "past";
}) {
  if (entries.length === 0) return <p className="bls-empty-copy">{emptyMessage}</p>;
  return (
    <ol className="bls-calendar-list">
      {entries.map((entry) => (
        <li key={`${entry.report_id}-${entry.scheduled_at}`}>
          <time dateTime={entry.scheduled_at}>
            <strong>{formatDate(entry.scheduled_at)}</strong>
            <span>{clockTime(entry)}</span>
          </time>
          <span className="bls-calendar-copy">
            <b>{calendarLabel(entry)}</b>
            <span>{entry.report_id}</span>
          </span>
          <span className="bls-status-label">{phase === "upcoming" ? "Scheduled" : "Scheduled time passed"}</span>
          <a href={entry.source_url} target="_blank" rel="noreferrer">Official schedule source</a>
        </li>
      ))}
    </ol>
  );
}

export default function ReleaseCalendar({ entries, asOf }: ReleaseCalendarProps) {
  const asOfTime = new Date(asOf).getTime();
  const upcoming = [...entries]
    .filter((entry) => new Date(entry.scheduled_at).getTime() > asOfTime)
    .sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at));
  const recent = [...entries]
    .filter((entry) => new Date(entry.scheduled_at).getTime() <= asOfTime)
    .sort((left, right) => right.scheduled_at.localeCompare(left.scheduled_at));
  const chronological = [...entries]
    .sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at));
  const visibleUpcoming = upcoming.slice(0, VISIBLE_EVENTS_PER_PHASE);
  const visibleRecent = recent.slice(0, VISIBLE_EVENTS_PER_PHASE);

  return (
    <section id="bls-calendar" className="bls-calendar section-anchor" aria-labelledby="bls-calendar-title">
      <header className="bls-section-header">
        <div>
          <p className="bls-section-kicker">Calendar</p>
          <h2 id="bls-calendar-title">Release schedule rail</h2>
          <p>Calendar timestamps are schedule evidence only. A past time does not confirm a release occurred and is not linked to an observation or reference period.</p>
        </div>
        <span className="bls-clock-label">Schedule clock · scheduled U.S. Eastern</span>
      </header>
      <div className="bls-calendar-columns">
        <div>
          <h3>Upcoming scheduled releases</h3>
          <CalendarList
            entries={visibleUpcoming}
            emptyMessage="No upcoming scheduled release is present in the returned calendar."
            phase="upcoming"
          />
          {upcoming.length > visibleUpcoming.length ? (
            <p className="bls-chart-footnote">Showing the next {visibleUpcoming.length} of {upcoming.length} scheduled events.</p>
          ) : null}
        </div>
        <div>
          <h3>Past scheduled releases</h3>
          <CalendarList
            entries={visibleRecent}
            emptyMessage="No past scheduled release is present in the returned calendar."
            phase="past"
          />
          {recent.length > visibleRecent.length ? (
            <p className="bls-chart-footnote">Showing the latest {visibleRecent.length} of {recent.length} past scheduled events.</p>
          ) : null}
        </div>
      </div>
      {chronological.length > 0 ? (
        <details className="bls-calendar-history">
          <summary>View all {chronological.length} returned scheduled events</summary>
          <DataScroller
            label="Complete returned BLS release schedule"
            hint="Scroll horizontally or vertically to inspect the complete retained schedule history."
          >
            <table className="bls-table bls-calendar-table">
              <thead>
                <tr>
                  <th scope="col">Scheduled date</th>
                  <th scope="col">Scheduled time</th>
                  <th scope="col">Report</th>
                  <th scope="col">Schedule state</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {chronological.map((entry) => {
                  const isUpcoming = new Date(entry.scheduled_at).getTime() > asOfTime;
                  return (
                    <tr key={`${entry.report_id}-${entry.scheduled_at}`}>
                      <th scope="row">{formatDate(entry.scheduled_at)}</th>
                      <td>{clockTime(entry)}</td>
                      <td>{calendarLabel(entry)}</td>
                      <td>{isUpcoming ? "Scheduled" : "Scheduled time passed"}</td>
                      <td><a href={entry.source_url} target="_blank" rel="noreferrer">Official schedule source</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataScroller>
        </details>
      ) : null}
    </section>
  );
}
