import { useMemo, useState } from "react";

import { releaseCalendarHref } from "./blsOverviewModel";
import { calendarLabel, clockTime, formatDate } from "./format";
import type { BlsCalendarEntry } from "./types";

type ReleaseCalendarProps = {
  entries: BlsCalendarEntry[];
  asOf: string;
};

type CalendarMode = "list" | "month";

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "America/New_York",
});

function monthKey(entry: BlsCalendarEntry): string {
  const date = new Date(entry.scheduled_at);
  return Number.isNaN(date.getTime()) ? entry.scheduled_at.slice(0, 7) : monthFormatter.format(date);
}

function CalendarEvent({ entry, emphasized = false }: { entry: BlsCalendarEntry; emphasized?: boolean }) {
  const downloadHref = releaseCalendarHref(entry);
  return (
    <li className={emphasized ? "bls-calendar-event bls-calendar-event-next" : "bls-calendar-event"}>
      <time dateTime={entry.scheduled_at}>
        <strong>{formatDate(entry.scheduled_at)}</strong>
        <span>{clockTime(entry)}</span>
      </time>
      <div className="bls-calendar-copy">
        <b>{calendarLabel(entry)}</b>
      </div>
      <div className="bls-calendar-event-actions">
        {emphasized ? <span className="bls-status-label">Scheduled</span> : null}
        <details>
          <summary>Official source &amp; calendar</summary>
          <div>
            <a href={entry.source_url} target="_blank" rel="noreferrer">Official schedule source</a>
            {downloadHref ? <a href={downloadHref} download={`bls-${entry.report_id}-${entry.scheduled_at.slice(0, 10)}.ics`}>Add to calendar</a> : null}
          </div>
        </details>
      </div>
    </li>
  );
}

function groupByMonth(entries: BlsCalendarEntry[]) {
  const groups = new Map<string, BlsCalendarEntry[]>();
  entries.forEach((entry) => {
    const key = monthKey(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  });
  return [...groups.entries()];
}

export default function ReleaseCalendar({ entries, asOf }: ReleaseCalendarProps) {
  const [mode, setMode] = useState<CalendarMode>("list");
  const asOfTime = new Date(asOf).getTime();
  const upcoming = useMemo(() => [...entries]
    .filter((entry) => new Date(entry.scheduled_at).getTime() > asOfTime)
    .sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at)), [asOfTime, entries]);
  const past = useMemo(() => [...entries]
    .filter((entry) => new Date(entry.scheduled_at).getTime() <= asOfTime)
    .sort((left, right) => right.scheduled_at.localeCompare(left.scheduled_at)), [asOfTime, entries]);
  const nextThree = upcoming.slice(0, 3);
  const monthModeEntries = [...past.slice(0, 24).reverse(), ...upcoming.slice(0, 24)]
    .sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at));

  return (
    <section id="bls-calendar" className="bls-calendar section-anchor" aria-labelledby="bls-calendar-title">
      <header className="bls-section-header">
        <div>
          <p className="bls-section-kicker">Calendar</p>
          <h2 id="bls-calendar-title">BLS release schedule</h2>
          <p>Scheduled times are shown in U.S. Eastern. A past scheduled time does not prove publication or identify an observation vintage.</p>
        </div>
        <span className="bls-clock-label">Schedule clock · U.S. Eastern</span>
      </header>

      <div className="bls-calendar-toolbar">
        <div className="bls-window-control" role="group" aria-label="Calendar display">
          <button type="button" aria-pressed={mode === "list"} onClick={() => setMode("list")}>List</button>
          <button type="button" aria-pressed={mode === "month"} onClick={() => setMode("month")}>Month groups</button>
        </div>
        <span>{upcoming.length} upcoming · {past.length} past scheduled times</span>
      </div>

      {mode === "list" ? (
        <div className="bls-calendar-list-view">
          <section aria-labelledby="bls-calendar-upcoming-title">
            <h3 id="bls-calendar-upcoming-title">What comes next</h3>
            {nextThree.length > 0 ? (
              <ol className="bls-calendar-list">
                {nextThree.map((entry, index) => <CalendarEvent key={`${entry.report_id}-${entry.scheduled_at}`} entry={entry} emphasized={index === 0} />)}
              </ol>
            ) : <p className="bls-empty-copy">No upcoming scheduled release is present in the returned calendar.</p>}
            {upcoming.length > nextThree.length ? (
              <details className="bls-calendar-history">
                <summary>View {upcoming.length - nextThree.length} later scheduled releases</summary>
                <ol className="bls-calendar-list">
                  {upcoming.slice(3).map((entry) => <CalendarEvent key={`${entry.report_id}-${entry.scheduled_at}`} entry={entry} />)}
                </ol>
              </details>
            ) : null}
          </section>

          <section aria-labelledby="bls-calendar-past-title">
            <h3 id="bls-calendar-past-title">Past scheduled times</h3>
            <div className="bls-past-months">
              {groupByMonth(past).map(([month, monthEntries]) => (
                <details key={month}>
                  <summary>{month} · {monthEntries.length} event{monthEntries.length === 1 ? "" : "s"}</summary>
                  <ol className="bls-calendar-list">
                    {monthEntries.map((entry) => <CalendarEvent key={`${entry.report_id}-${entry.scheduled_at}`} entry={entry} />)}
                  </ol>
                </details>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div>
          <p className="bls-chart-footnote">Month groups show up to 24 recent past and 24 upcoming scheduled events. The complete retained history remains available in the collapsed past-month list.</p>
          <div className="bls-calendar-month-grid" aria-label="BLS schedule grouped by month">
          {groupByMonth(monthModeEntries).map(([month, monthEntries]) => (
            <section key={month} aria-labelledby={`bls-month-${month.replace(/\W+/g, "-").toLowerCase()}`}>
              <h3 id={`bls-month-${month.replace(/\W+/g, "-").toLowerCase()}`}>{month}</h3>
              <ol>
                {monthEntries.map((entry) => {
                  const upcomingEntry = new Date(entry.scheduled_at).getTime() > asOfTime;
                  return (
                    <li key={`${entry.report_id}-${entry.scheduled_at}`}>
                      <time dateTime={entry.scheduled_at}>{formatDate(entry.scheduled_at)} · {clockTime(entry)}</time>
                      <strong>{calendarLabel(entry)}</strong>
                      <span>{upcomingEntry ? "Upcoming scheduled time" : "Scheduled time passed"}</span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          </div>
        </div>
      )}
    </section>
  );
}
