import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, RefreshCw, X } from "lucide-react";
import { apiFetch } from "../../utils/apiUtils";

interface ExitPlanRow {
  position_id: number;
  fingerprint: string;
  account: string | null;
  symbol: string;
  contract_symbol: string | null;
  expiration: string;
  strike: number;
  option_type: string;
  contracts: number;
  actual_fill: number;
  source_event_id: number | null;
  source_triggered_at: string | null;
  source_is_candidate: boolean;
  levels: { entry_premium: number; stop_premium: number; target_premium: number; target_basis: string } | null;
  status: "needs_plan" | "review" | "stop_crossed" | "target_crossed";
  reasons: string[];
  warnings: string[];
  indicative_mark: number | null;
  mark_source: string | null;
  last_trade_at: string | null;
}

interface ExitPlanQueue {
  as_of: string;
  rows: ExitPlanRow[];
  summary: { lots: number; with_levels: number; stop_crossed: number; needs_plan: number };
  broker_review: string;
  fidelity_help_url: string;
}

const STORAGE_KEY = "secretOptions.ocoEntered.v1";
const money = (value: number | null | undefined) => value == null ? "—" : `$${value.toFixed(2)}`;
const statusLabel = { needs_plan: "Missing or mismatched plan", review: "Review original levels", stop_crossed: "Mark below original stop", target_crossed: "Mark above original target" };

function readAcknowledgements(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, stamp]) => /^[a-f0-9]{24}$/.test(key) && typeof stamp === "string" && Number.isFinite(Date.parse(stamp))).slice(-2000));
  } catch { return {}; }
}

function referenceText(row: ExitPlanRow): string {
  if (!row.levels) return "";
  return [
    "REFERENCE ONLY — review and submit in Fidelity Trader+ Desktop",
    `Account: ${row.account ?? "VERIFY ACCOUNT"}`,
    `Contract lookup: ${row.contract_symbol ?? "VERIFY CONTRACT"}`,
    `Existing long lot #${row.position_id}: ${row.contracts} contracts (verify available quantity and existing orders)`,
    "Conditional action: Sell bracket (OCO); both legs SELL TO CLOSE the same quantity",
    `Sell limit target: ${money(row.levels.target_premium)} (${row.levels.target_basis})`,
    `Sell stop trigger: ${money(row.levels.stop_premium)} (option premium, NOT stock price)`,
    "Choose stop-market or stop-limit in Fidelity; no stop-limit execution price has been supplied.",
    "Choose the same time-in-force for both legs in Fidelity; verify expiry and permitted price increments.",
    `Scanner example #${row.source_event_id}; ${row.source_is_candidate ? "candidate association" : "saved association"}; entry reference ${money(row.levels.entry_premium)}; actual fill ${money(row.actual_fill)}`,
    `Review: ${[...row.reasons, ...row.warnings].join(" ")}`,
    "No broker order has been placed or verified by the tracker.",
  ].join("\n");
}

export function OcoExitPlans({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<ExitPlanQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [entered, setEntered] = useState(readAcknowledgements);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setData(null);
    setError(null);
    setNotice("");
    try {
      const result = await apiFetch<ExitPlanQueue>("/secret/options/exit-plans");
      if (id === requestId.current) setData(result);
    } catch (err) {
      if (id === requestId.current) setError(err instanceof Error ? err.message : "Could not load exit plans.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); return () => { requestId.current += 1; }; }, [load]);

  const copy = async (text: string, label: string) => {
    setNotice("");
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label} copied. No order was placed.`);
    } catch { setError("Clipboard access failed. Expand the reference and copy its text manually."); }
  };
  const toggleEntered = (row: ExitPlanRow) => {
    const next = { ...entered };
    if (next[row.fingerprint]) delete next[row.fingerprint];
    else next[row.fingerprint] = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(next).slice(-2000))));
      setEntered(next);
      setNotice("Your entry note was saved in this browser. Broker order status remains unverified.");
    } catch { setError("Could not save the entry note in this browser. Broker order status remains unknown."); }
  };
  const rows = (data?.rows ?? []).filter(row => filter === "all"
    || (filter === "levels" && Boolean(row.levels))
    || (filter === "needs_plan" && row.status === "needs_plan")
    || (filter === "entered" && Boolean(entered[row.fingerprint])));
  const recorded = data?.rows.filter(row => entered[row.fingerprint]).length ?? 0;
  const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stealth-600 px-3 py-2 text-sm font-semibold text-stealth-100 hover:bg-stealth-800 disabled:cursor-not-allowed disabled:opacity-45";

  return <div className="max-h-[calc(100dvh-2rem)] w-[min(1100px,95vw)] max-w-full overflow-y-auto rounded-xl border border-stealth-700 bg-stealth-900 p-4 sm:p-5">
    <header className="sticky -top-4 z-10 -mx-4 flex flex-wrap items-start justify-between gap-3 border-b border-stealth-700 bg-stealth-900 px-4 pb-3 pt-4 sm:-top-5 sm:-mx-5 sm:px-5 sm:pt-5">
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-semibold text-stealth-100">OCO exit plans</h2>
        <p className="mt-1 text-sm leading-6 text-stealth-300">Saved scanner levels for all open lots, including personal ETF bets. Review and submit in Fidelity Trader+ Desktop.</p>
      </div>
      <button type="button" className={buttonClass} onClick={onClose} aria-label="Close OCO exit plans"><X className="h-4 w-4" aria-hidden="true" /></button>
    </header>
    <p className="mt-3 rounded-lg border border-amber-700/60 bg-amber-950/20 p-3 text-sm leading-6 text-amber-100">
      These are original option-premium levels, not new recommendations or verified broker orders. Account funding and restrictions remain unverified. Copying or recording an entry does not protect a position.
    </p>
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 flex-col gap-1 text-sm text-stealth-200">Show
        <select aria-label="Show exit plans" className="min-h-11 rounded-lg border border-stealth-600 bg-stealth-950 px-3 text-sm text-stealth-100" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All lots</option><option value="levels">With saved levels</option><option value="needs_plan">Missing / mismatched plans</option><option value="entered">Recorded as entered by me</option>
        </select>
      </label>
      <button type="button" className={buttonClass} disabled={loading} onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh plans</button>
      <button type="button" className={buttonClass} disabled={!data?.rows.some(row => row.levels) || loading} onClick={() => void copy(data!.rows.filter(row => row.levels).map(referenceText).join("\n\n---\n\n"), "Reference sheet")}><Copy className="h-4 w-4" aria-hidden="true" /> Copy reference sheet</button>
    </div>
    {data ? <p className="mt-3 text-sm text-stealth-300">{data.summary.with_levels} of {data.summary.lots} lots have matching saved levels · {data.summary.stop_crossed} marks below the original stop · {recorded} recorded as entered by you, unverified</p> : null}
    <div role="status" aria-live="polite" className="mt-2 text-sm leading-6 text-sky-200">{loading ? "Loading saved exit plans…" : notice}</div>
    {error ? <p role="alert" className="mt-2 text-sm leading-6 text-rose-200">{error}</p> : null}
    <div className="mt-3 space-y-3">
      {!loading && data && rows.length === 0 ? <p className="py-4 text-sm text-stealth-300">No lots match this view.</p> : null}
      {rows.map(row => <article key={row.position_id} aria-label={`${row.symbol} exit plan lot ${row.position_id}`} className="rounded-lg border border-stealth-700 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-stealth-100">{row.symbol} · {row.expiration} · {money(row.strike)} {row.option_type.toUpperCase()}</h3>
            <p className="mt-1 break-words text-sm text-stealth-300">{row.account ?? "Missing account"} · lot #{row.position_id} · {row.contracts} contracts</p>
          </div>
          <span className={`text-sm font-semibold ${row.status === "review" ? "text-sky-200" : "text-amber-200"}`}>{statusLabel[row.status]}</span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div><dt className="text-stealth-400">Original entry</dt><dd className="tabular-nums text-stealth-100">{money(row.levels?.entry_premium)}</dd></div>
          <div><dt className="text-stealth-400">Stop premium</dt><dd className="tabular-nums text-stealth-100">{row.levels ? <button type="button" aria-label="Copy stop premium" className="min-h-11 underline decoration-stealth-500 underline-offset-4" onClick={() => void copy(row.levels!.stop_premium.toFixed(2), `${row.symbol} stop premium`)}>{money(row.levels.stop_premium)}</button> : "—"}</dd></div>
          <div><dt className="text-stealth-400">{row.levels?.target_basis ?? "Target"} premium</dt><dd className="tabular-nums text-stealth-100">{row.levels ? <button type="button" aria-label="Copy target premium" className="min-h-11 underline decoration-stealth-500 underline-offset-4" onClick={() => void copy(row.levels!.target_premium.toFixed(2), `${row.symbol} target premium`)}>{money(row.levels.target_premium)}</button> : "—"}</dd></div>
          <div><dt className="text-stealth-400">Indicative mark</dt><dd className="tabular-nums text-stealth-100">{money(row.indicative_mark)}</dd></div>
        </dl>
        {row.last_trade_at ? <p className="mt-2 break-words text-xs leading-5 text-stealth-400">Last option trade: {row.last_trade_at} · mark basis: {row.mark_source ?? "unknown"}</p> : null}
        {row.reasons.length ? <p className="mt-2 text-sm leading-6 text-amber-100">{row.reasons.join(" ")}</p> : null}
        <details className="mt-2 text-sm text-stealth-300">
          <summary className="min-h-11 cursor-pointer py-3 font-semibold text-stealth-200">Source and review notes{row.source_event_id ? ` · scanner #${row.source_event_id}${row.source_is_candidate ? " (candidate)" : ""}` : ""}</summary>
          {row.source_triggered_at ? <p className="break-words text-xs leading-5 text-stealth-400">Saved signal: {row.source_triggered_at} · actual fill {money(row.actual_fill)}</p> : null}
          <ul className="mt-2 list-disc space-y-1 pl-5 leading-6">{row.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
          {row.levels ? <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-stealth-950 p-3 font-mono text-xs leading-6">{referenceText(row)}</pre> : null}
        </details>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass} disabled={!row.contract_symbol} onClick={() => void copy(row.contract_symbol!, `${row.symbol} contract lookup`)}>Copy contract</button>
          <button type="button" className={buttonClass} disabled={!row.levels} onClick={() => void copy(referenceText(row), `${row.symbol} plan reference`)}>Copy plan reference</button>
          {row.levels ? <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-stealth-200">
            <input type="checkbox" checked={Boolean(entered[row.fingerprint])} onChange={() => toggleEntered(row)} className="h-4 w-4 accent-sky-400" />I entered this in Fidelity (unverified)
          </label> : null}
        </div>
      </article>)}
    </div>
    {data ? <footer className="mt-4 space-y-2 border-t border-stealth-700 pt-3 text-sm leading-6 text-stealth-300">
      <p>{data.broker_review}</p>
      <p>Entry notes are saved only in this browser and reset for a changed quantity or plan. Check Fidelity Orders to confirm actual protection.</p>
      <a className="inline-flex min-h-11 items-center text-sky-200 underline" href={data.fidelity_help_url} target="_blank" rel="noreferrer">Trader+ Desktop conditional-order guide</a>
    </footer> : null}
  </div>;
}
