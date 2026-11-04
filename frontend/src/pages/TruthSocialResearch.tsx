import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import AccessibleChartFrame from "../components/ui/AccessibleChartFrame";
import PageHeader from "../components/ui/PageHeader";
import PageState from "../components/ui/PageState";
import SegmentedControl from "../components/ui/SegmentedControl";
import { useApi } from "../hooks/useApi";
import { commonGridProps, commonTooltipStyle, commonXAxisProps, commonYAxisProps } from "../utils/chartUtils";
import { dayTimestamp, displayDate, monthlyPace, postKindLabels, postingSeries, type PostKind, type TruthDay } from "../utils/truthSocial";
import "./TruthSocialResearch.css";

type Archive = { year: number; timezone: string; fetched_at: string; archive_through: string; start_date: string; end_date: string; stale: boolean; refresh_error: string | null; source: { name: string; url: string }; caveats: string[]; days: TruthDay[] };
const currentYear = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(new Date()));
const count = (value: number) => value.toLocaleString("en-US");
const axisDate = (value: number) => new Date(value).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

function downloadRows(days: TruthDay[], year: number) {
  const csv = ["date_eastern,all_posts,originals,quotes,retruths,partial_day", ...days.map(row => [row.date, row.total, row.originals, row.quotes, row.retruths, row.partial].join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `truth-social-${year}.csv`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ResearchView({ data, reload }: { data: Archive; reload: () => void }) {
  const [kind, setKind] = useState<PostKind>("total");
  const [from, setStart] = useState("");
  const [through, setEnd] = useState("");
  const [selected, setSelected] = useState("");
  const start = from || data.start_date;
  const end = through || data.end_date;
  const series = useMemo(() => postingSeries(data.days, kind).filter(row => row.date >= start && row.date <= end), [data.days, kind, start, end]);
  const months = useMemo(() => monthlyPace(series, kind), [series, kind]);
  const ended = series.filter(row => !row.partial);
  const total = series.reduce((sum, row) => sum + row.posts, 0);
  const peak = series.length ? series.reduce((a, b) => a.posts >= b.posts ? a : b) : null;
  const selectedDay = series.find(row => row.date === selected) ?? series[series.length - 1];
  const peakCount = peak?.posts ?? 0;
  const pick = (date: string) => setSelected(date);

  return <>
    {data.stale && <PageState variant="stale" title="Showing a saved fetch" message={data.refresh_error ?? "The archive could not be refreshed."} />}
    <div className="truth-source-line">
      <span>Archive through <strong>{displayDate(data.archive_through, true)}</strong></span>
      <span>Fetched {new Date(data.fetched_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</span>
      <button type="button" className="field-button field-button-secondary" onClick={reload}>Reload</button>
    </div>
    <p className="truth-qualification">Recent counts may grow as posts are captured. Dates after the archive’s coverage are not shown as zero.</p>
    <section className="truth-controls" aria-label="Explore posting activity">
      <SegmentedControl label="Post types" value={kind} onChange={setKind} options={(Object.keys(postKindLabels) as PostKind[]).map(value => ({ value, label: postKindLabels[value] }))} />
      <div className="truth-date-range">
        <label>From<input type="date" value={start} min={data.start_date} max={end} onChange={e => e.target.value && setStart(e.target.value)} /></label>
        <label>Through<input type="date" value={end} min={start} max={data.end_date} onChange={e => e.target.value && setEnd(e.target.value)} /></label>
        <button type="button" className="field-button field-button-secondary" onClick={() => { setStart(""); setEnd(""); }}>Full year</button>
        <button type="button" className="field-button field-button-secondary" disabled={!series.length} onClick={() => downloadRows(series, data.year)}>Download CSV</button>
      </div>
    </section>
    {!series.length ? <PageState variant="empty" title="No dates in this range" message="Choose a range within the archive’s coverage." /> : <>
      <dl className="truth-summary" aria-label="Selected range summary">
        <div><dt>{postKindLabels[kind]} in range</dt><dd>{count(total)}</dd></div>
        <div><dt>Per ended calendar day</dt><dd>{ended.length ? (ended.reduce((sum, row) => sum + row.posts, 0) / ended.length).toFixed(1) : "—"}</dd></div>
        <div><dt>Highest daily count</dt><dd>{count(peakCount)}<span>{peak ? displayDate(peak.date) : ""}{peak?.partial ? " · partial" : ""}</span></dd></div>
      </dl>
      <AccessibleChartFrame title="Daily posting rhythm" description={`${postKindLabels[kind]} · ${displayDate(start)}–${displayDate(end)} · America/New_York`} summary="Daily counts and a trailing seven-day average. Select any date below to inspect it. Current-day counts are partial and excluded from the average."
        dataTable={<table className="truth-table"><thead><tr><th scope="col">Date (Eastern)</th><th scope="col">Posts</th><th scope="col">7-day average</th><th scope="col">Day status</th></tr></thead><tbody>{series.map(row => <tr key={row.date}><th scope="row"><button type="button" onClick={() => pick(row.date)}>{row.date}</button></th><td>{row.posts}</td><td>{row.average?.toFixed(1) ?? "—"}</td><td>{row.partial ? "Partial day" : "Calendar day ended"}</td></tr>)}</tbody></table>}>
        <div className="truth-main-chart">
          <ResponsiveContainer width="100%" height="100%"><ComposedChart data={series} margin={{ top: 12, right: 14, bottom: 10, left: 0 }} accessibilityLayer aria-label="Truth Social daily counts and trailing seven-day posting average">
            <CartesianGrid {...commonGridProps} vertical={false} />
            <XAxis {...commonXAxisProps} dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={axisDate} minTickGap={48} />
            <YAxis {...commonYAxisProps} domain={[0, "auto"]} allowDecimals={false} width={44} label={{ value: "Posts / day", angle: -90, position: "insideLeft", fill: "var(--field-text-muted)" }} />
            <Tooltip contentStyle={commonTooltipStyle} labelFormatter={value => axisDate(Number(value))} formatter={(value, name) => [Number(value).toLocaleString("en-US", { maximumFractionDigits: name === "7-day average" ? 1 : 0 }), name]} />
            <Legend />
            <ReferenceLine x={selectedDay ? dayTimestamp(selectedDay.date) : undefined} stroke="var(--field-text-muted)" strokeDasharray="4 4" />
            <Line type="linear" dataKey="posts" name="Daily posts" stroke="var(--truth-daily)" strokeWidth={1.4} dot={series.length < 3} connectNulls={false} isAnimationActive={false} />
            <Line type="linear" dataKey="average" name="7-day average" stroke="var(--truth-average)" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
          </ComposedChart></ResponsiveContainer>
        </div>
      </AccessibleChartFrame>
      {selectedDay && <section className="truth-inspection" aria-labelledby="truth-day-heading" aria-live="polite">
        <div><h2 id="truth-day-heading">{displayDate(selectedDay.date, true)}</h2><label className="truth-inspect-label">Inspect a date<input type="date" value={selectedDay.date} min={start} max={end} onChange={e => e.target.value && pick(e.target.value)} /></label></div>
        <dl>{(["total", "originals", "quotes", "retruths"] as PostKind[]).map(key => <div key={key}><dt>{postKindLabels[key]}</dt><dd>{count(selectedDay[key])}</dd></div>)}</dl>
        <a href={`${data.source.url}?start_date=${selectedDay.date}&end_date=${selectedDay.date}`} target="_blank" rel="noreferrer">Open this day in the source ↗</a>
        {selectedDay.partial && <p>Partial calendar day.</p>}
      </section>}
      <div className="truth-lower-grid">
        <AccessibleChartFrame title="Monthly pace" description="Average posts per ended calendar day within the selected range; partial months use only the dates shown.">
          <div className="truth-month-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={months} margin={{ top: 10, right: 12, bottom: 8, left: 0 }} accessibilityLayer aria-label="Truth Social monthly average posts per ended calendar day">
            <CartesianGrid {...commonGridProps} vertical={false} /><XAxis {...commonXAxisProps} dataKey="month" tickFormatter={value => new Date(`${value}-01T12:00:00Z`).toLocaleString("en-US", { timeZone: "UTC", month: "short" })} minTickGap={18} />
            <YAxis {...commonYAxisProps} domain={[0, "auto"]} width={40} /><Tooltip contentStyle={commonTooltipStyle} labelFormatter={(label, payload) => `${label} · ${payload[0]?.payload.days ?? 0} ended days`} formatter={value => [Number(value).toFixed(1), "Posts / day"]} />
            <Bar dataKey="pace" name="Posts / day" fill="var(--truth-average)" isAnimationActive={false} />
          </BarChart></ResponsiveContainer></div>
        </AccessibleChartFrame>
        <section className="truth-day-index" aria-labelledby="truth-calendar-heading"><h2 id="truth-calendar-heading">Calendar index</h2><p>Daily counts · {postKindLabels[kind].toLowerCase()} · select a day</p>
          <div className="truth-calendar">{[...new Set(series.map(row => row.date.slice(0, 7)))].map(month => <div key={month}><h3>{new Date(`${month}-01T12:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" })}</h3><div className="truth-month-days">{series.filter(row => row.date.startsWith(month)).map(row => <button key={row.date} type="button" aria-pressed={row.date === selectedDay?.date} className="truth-day" style={{ backgroundColor: `color-mix(in srgb, var(--truth-daily) ${peakCount ? Math.round(row.posts / peakCount * 50) : 0}%, var(--field-surface))` }} aria-label={`${displayDate(row.date)}, ${row.posts} ${postKindLabels[kind].toLowerCase()}${row.partial ? ', partial day' : ''}`} onClick={() => pick(row.date)}><span>{Number(row.date.slice(-2))}</span><strong>{row.posts}</strong></button>)}</div></div>)}</div>
        </section>
      </div>
    </>}
    <details className="truth-methods"><summary>Source, definitions &amp; coverage</summary><div>
      <p><a href={data.source.url} target="_blank" rel="noreferrer">{data.source.name} ↗</a> supplies these counts. <a href="https://www.trumpstruth.org/" target="_blank" rel="noreferrer">Browse the archived posts ↗</a></p>
      <ul>{data.caveats.map(caveat => <li key={caveat}>{caveat}</li>)}</ul>
      <p>The seven-day average requires seven consecutive, ended calendar days. It uses earlier dates in the same year when the visible range starts later. Monthly pace excludes the current day. CSV includes all post-type columns for the selected dates.</p>
    </div></details>
  </>;
}

export default function TruthSocialResearch() {
  const [year, setYear] = useState(currentYear);
  const { data, loading, error, refetch } = useApi<Archive>(`/research/truth-social?year=${year}`, { retainPreviousData: false, timeoutMs: 35000 });
  return <div className="page-shell page-stack truth-research">
    <PageHeader kicker="Research" title="Truth Social activity" description="A calendar of @realDonaldTrump’s posting patterns." actions={<label className="truth-year">Year<select value={year} onChange={e => setYear(Number(e.target.value))}>{Array.from({ length: currentYear - 2021 }, (_, i) => currentYear - i).map(value => <option key={value} value={value}>{value}</option>)}</select></label>} />
    {loading && <PageState variant="loading" title="Loading the archive" message="Fetching and validating daily post counts." />}
    {error && <PageState variant="error" title="Archive unavailable" message={error} actions={<button type="button" className="field-button field-button-secondary" onClick={refetch}>Try again</button>} />}
    {data && <ResearchView key={data.year} data={data} reload={refetch} />}
  </div>;
}
