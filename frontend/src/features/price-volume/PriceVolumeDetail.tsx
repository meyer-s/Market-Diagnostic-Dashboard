import { useId } from "react";
import { longestStreak, money, percent, referenceRange, sessionDate } from "./format";
import type { PriceVolumeSignal } from "./types";

export function PressureBadge({ pressure }: { pressure: PriceVolumeSignal["pressure"] }) {
  const tone = pressure === "positive" ? "text-emerald-300 border-emerald-700" : pressure === "negative" ? "text-rose-300 border-rose-700" : "text-stealth-200 border-stealth-600";
  return <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${tone}`}>{pressure === "mixed" ? "Mixed bars" : `${pressure[0].toUpperCase()}${pressure.slice(1)}-bar balance`}</span>;
}

export default function PriceVolumeDetail({ signal }: { signal: PriceVolumeSignal }) {
  const headingId = useId();
  const range = referenceRange(signal.positive_reference_price, signal.negative_reference_price, signal.latest_price);
  const timeline = signal.flow_timeline ?? [];
  const scale = Math.max(1, ...timeline.map(week => Math.abs(week.signed_turnover_usd)));
  const renderWeek = (week: typeof timeline[number]) => {
    const value = week.signed_turnover_usd;
    const count = week.positive_events + week.negative_events + week.neutral_events;
    return <li key={week.bucket} className="surface-card-muted grid grid-cols-[minmax(0,1fr)_minmax(60px,1fr)_minmax(0,1fr)] items-center gap-2 p-2 text-xs">
      <span>Week of {sessionDate(week.bucket)}</span>
      <span className="relative h-3 rounded bg-stealth-800" aria-hidden="true">
        <span className="absolute inset-y-0 left-1/2 w-px bg-stealth-400" />
        <span className={`absolute inset-y-0 ${value >= 0 ? "bg-emerald-400" : "bg-rose-400"}`} style={{ [value >= 0 ? "left" : "right"]: "50%", width: `${Math.abs(value) / scale * 50}%` }} />
      </span>
      <span className="text-right">{money(value, true)}<span className="block text-stealth-300">{week.observed_bars === 0 ? "No provider bars" : `${count} flagged / ${week.observed_bars} observed`}</span></span>
    </li>;
  };
  return <article className="surface-card min-w-0 p-4" aria-labelledby={headingId}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><p className="page-kicker">Price & volume evidence</p><h3 id={headingId} className="mt-1 text-xl font-semibold">{signal.symbol.replace(/-USD$/, "")}</h3></div>
      <PressureBadge pressure={signal.pressure} />
    </div>
    {signal.status !== "ok" && <p className="mt-3 text-sm text-amber-300" role="status">Insufficient source history for the prior 20-bar baseline.</p>}
    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
      <div><dt className="text-xs text-stealth-300">Latest daily price</dt><dd className="font-semibold">{money(signal.latest_price)}</dd><dd className="text-xs text-stealth-300">Provider bar: {sessionDate(signal.latest_bar_date)}</dd></div>
      <div><dt className="text-xs text-stealth-300">Flagged days</dt><dd className="font-semibold">{signal.event_count} / {signal.eligible_bars} baseline-ready bars</dd><dd className="text-xs text-stealth-300">{signal.observed_bars} observed bars</dd></div>
      <div><dt className="text-xs text-stealth-300">Mean flagged volume z-score</dt><dd className="font-semibold">{signal.mean_volume_z?.toFixed(2) ?? "—"}</dd></div>
      <div><dt className="text-xs text-stealth-300">Latest flagged day</dt><dd className="font-semibold">{sessionDate(signal.latest_event_date)}</dd></div>
    </dl>
    <div className="surface-card-muted mt-4 p-3">
      <div className="text-xs text-stealth-300">Signed flagged turnover · full window</div>
      <div className="mt-1 text-lg font-semibold">{money(signal.signed_turnover_usd, true)} <span className="text-sm text-stealth-300">({percent(signal.pressure_balance_pct)} balance)</span></div>
      <p className="mt-1 text-xs text-stealth-300">Positive-bar turnover minus negative-bar turnover. Balance divides this by all flagged turnover.</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><dt>Positive bars</dt><dd className="text-emerald-300">{money(signal.positive_turnover_usd, true)}</dd></div>
        <div><dt>Negative bars</dt><dd className="text-rose-300">{money(signal.negative_turnover_usd, true)}</dd></div>
        <div><dt>Mixed bars</dt><dd>{money(signal.neutral_turnover_usd, true)}</dd></div>
      </dl>
    </div>
    <details className="mt-4 border-t border-stealth-700 pt-3">
      <summary className="cursor-pointer text-sm font-semibold">Flagged closing-price references</summary>
      <p className="mt-2 text-xs text-stealth-300">Turnover-weighted closes of positive or negative flagged bars. These historical reference prices are not buy/sell targets.</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div><dt>Positive-bar reference</dt><dd>{money(signal.positive_reference_price)}</dd><dd className="text-xs text-stealth-300">Price change to reference: {percent(signal.change_to_positive_reference_pct)}</dd></div>
        <div><dt>Negative-bar reference</dt><dd>{money(signal.negative_reference_price)}</dd><dd className="text-xs text-stealth-300">Price change to reference: {percent(signal.change_to_negative_reference_pct)}</dd></div>
      </dl>
      {range && <div className="mt-3" aria-label="Closing-price reference range">
        <div className="flex justify-between gap-2 text-xs"><span>{range.lowLabel}<br />{money(range.low)}</span><span className="text-right">{range.highLabel}<br />{money(range.high)}</span></div>
        <div className="relative mx-2 mt-2 h-2 rounded bg-stealth-700">{range.position != null && <span className="absolute -top-1 h-4 w-1 -translate-x-1/2 bg-white" style={{ left: `${range.position}%` }} />}</div>
        <p className="mt-2 text-xs text-stealth-300">{range.location}</p>
      </div>}
    </details>
    {timeline.length > 0 && <section className="mt-4 border-t border-stealth-700 pt-3" aria-label="Weekly signed turnover">
      <h4 className="text-sm font-semibold">Weekly signed turnover</h4>
      <p className="mt-1 text-xs text-stealth-300">Calendar weeks, including weeks without triggers. Boundary weeks may be partial.</p>
      <ol className="mt-3 space-y-1">{timeline.slice(-4).map(renderWeek)}</ol>
      <p className="mt-2 text-xs text-stealth-300">Longest consecutive weeks in full window: positive {longestStreak(timeline, "positive")} · negative {longestStreak(timeline, "negative")}</p>
      {timeline.length > 4 && <details className="mt-2 text-xs"><summary className="cursor-pointer">Earlier weeks ({timeline.length - 4})</summary><ol className="mt-2 space-y-1">{timeline.slice(0, -4).map(renderWeek)}</ol></details>}
    </section>}
    <section className="mt-4 border-t border-stealth-700 pt-3" aria-label="Latest flagged days">
      <h4 className="text-sm font-semibold">Latest flagged days</h4>
      {signal.recent_events.length === 0 && <p className="mt-2 text-xs text-stealth-300">No days met the volume threshold in this window.</p>}
      <ul className="mt-2 space-y-2">{signal.recent_events.slice(0, 4).map(event => <li key={event.date} className="surface-card-muted p-2 text-xs">
        <div className="flex justify-between gap-2"><span>{sessionDate(event.date)}</span><span>{event.side === "buy" ? "Positive bar" : event.side === "sell" ? "Negative bar" : "Mixed bar"}</span></div>
        <div className="mt-1 text-stealth-300">Volume z {event.volume_z.toFixed(2)} · close location {event.clv.toFixed(2)} · day {percent(event.price_change_pct)}</div>
        <div className="mt-1">Turnover {money(event.notional, true)} · close {money(event.price)}</div>
      </li>)}</ul>
    </section>
    <p className="mt-4 text-xs leading-5 text-stealth-300">Window: {sessionDate(signal.window_start)}–{sessionDate(signal.window_end)}. Daily price-volume estimates do not identify institutional trades or net fund flows. {signal.volume_unit === "USD" ? "Crypto volume is already USD turnover." : "Turnover uses close × share volume."}</p>
  </article>;
}
