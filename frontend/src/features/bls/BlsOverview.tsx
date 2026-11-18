import { useMemo } from "react";

import { buildBlsBrief, type BriefFinding } from "./blsBriefModel";
import type { BlsOverviewTarget } from "./blsOverviewModel";
import { clockTime, formatDate, formatPeriod, formatSigned } from "./format";
import type { BlsLensResponse } from "./types";

export type BlsOverviewProps = {
  data: BlsLensResponse;
  onNavigate: (target: BlsOverviewTarget, seriesId?: string) => void;
};

function Finding({ finding, onNavigate }: { finding: BriefFinding; onNavigate: BlsOverviewProps["onNavigate"] }) {
  const focus = finding.readings.find((reading) => reading.series)?.id;
  return (
    <article className="bls-brief-finding" aria-labelledby={`bls-brief-${finding.id}`}>
      <div className="bls-brief-topic">{finding.topic}</div>
      <div className="bls-brief-finding-body">
        <h3 id={`bls-brief-${finding.id}`}>{finding.title}</h3>
        <p>{finding.interpretation}</p>
        {finding.qualification ? <p className="bls-brief-qualification">{finding.qualification}</p> : null}
        <details className="bls-brief-evidence">
          <summary><span>Evidence &amp; next check</span><span>{finding.preview}</span></summary>
          <dl className="bls-brief-receipts">
            {finding.readings.map((reading) => (
              <div key={reading.id}>
                <dt>{reading.label}</dt>
                <dd><strong>{reading.display}</strong><span>{reading.period ? formatPeriod(reading.period) : "Reference month unavailable"}{reading.preliminary ? " · Preliminary" : ""}</span></dd>
                <dd>{reading.comparison}</dd>
                <dd>{reading.source ? <a href={reading.source} target="_blank" rel="noreferrer">BLS source for {reading.label.toLowerCase()} ↗</a> : "Source unavailable"}</dd>
              </div>
            ))}
          </dl>
          <p><strong>Next check:</strong> {finding.watch}</p>
          {focus ? <button type="button" className="field-button field-button-secondary" onClick={() => onNavigate("trends", focus)}>Explore {finding.topic.toLowerCase()} history</button> : null}
        </details>
      </div>
    </article>
  );
}

export default function BlsOverview({ data, onNavigate }: BlsOverviewProps) {
  const brief = useMemo(() => buildBlsBrief(data), [data]);
  const next = brief.nextRelease;
  const revisions = brief.revisions;
  return (
    <section className="bls-brief" aria-labelledby="bls-overview-title">
      <header className="bls-section-header">
        <div>
          <h2 id="bls-overview-title">Labor &amp; inflation brief</h2>
          <p>What the latest observations support, and where the picture is incomplete.</p>
        </div>
        <button type="button" className="bls-header-refresh" onClick={() => onNavigate("methods")}>Methods &amp; sources</button>
      </header>

      <div className="bls-brief-findings">
        {brief.findings.map((finding) => <Finding key={finding.id} finding={finding} onNavigate={onNavigate} />)}
      </div>

      <div className="bls-brief-followup">
        <div>
          <h3>How revisions change the read</h3>
          <p>{revisions.netThreeMonth === null
            ? "Three consecutive revised payroll months are not available for a net comparison."
            : revisions.netThreeMonth > 0
              ? "Earlier payroll months now show more jobs than first reported."
              : revisions.netThreeMonth < 0
                ? "Earlier payroll months now show fewer jobs than first reported."
                : "The latest three revised payroll months have no net change from their first estimates."}</p>
          <button type="button" className="bls-header-refresh" onClick={() => onNavigate("revisions")}>
            {revisions.netThreeMonth === null ? "View revision history" : `${formatSigned(revisions.netThreeMonth * 1000, "", 0)} jobs across three revised months · inspect`}
          </button>
        </div>
        <div>
          <h3>Next scheduled check</h3>
          {next ? <>
            <p>{next.label}</p>
            <time dateTime={next.entry.scheduled_at}>{formatDate(next.entry.scheduled_at)} · {clockTime(next.entry)}</time>
            <div className="bls-brief-calendar-actions">
              <button type="button" className="bls-header-refresh" onClick={() => onNavigate("calendar")}>Full calendar</button>
              {next.calendarHref ? <a href={next.calendarHref} download={`bls-${next.entry.report_id}.ics`}>Add to calendar</a> : null}
            </div>
          </> : <><p>No upcoming event is available in the returned schedule.</p><button type="button" className="bls-header-refresh" onClick={() => onNavigate("calendar")}>Full calendar</button></>}
        </div>
      </div>

      <details className="bls-brief-limits">
        <summary>Confidence &amp; limits{brief.preliminary ? " · preliminary estimates" : ""}{brief.missing ? " · missing comparisons" : ""}</summary>
        <ul>{brief.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul>
      </details>
    </section>
  );
}
