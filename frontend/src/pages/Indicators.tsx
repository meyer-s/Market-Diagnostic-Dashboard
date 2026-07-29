import { useApi } from "../hooks/useApi";
import { IndicatorStatus } from "../types";
import { Link } from "react-router-dom";
import MarketLoading from "../components/ui/MarketLoading";
import { formatNumber } from "../utils/styleUtils";

const stateDotMap = {
  GREEN: "bg-accent-green",
  YELLOW: "bg-accent-yellow",
  RED: "bg-accent-red",
  UNKNOWN: "bg-stealth-500",
};

function resolveIndicatorDisplay(code: string, name: string) {
  if (code === "ANALYST_ANXIETY") {
    return { displayName: "Analyst Confidence", displayCode: "ANALYST_CONFIDENCE", routePath: "/indicators/ANALYST_CONFIDENCE", linkLabel: "View detail" };
  }
  if (code === "AGRICULTURE_STABILITY") {
    return { displayName: name, displayCode: code, routePath: "/agriculture", linkLabel: "Open page" };
  }
  if (code === "ENERGY_STABILITY") {
    return { displayName: name, displayCode: code, routePath: "/energy", linkLabel: "Open page" };
  }
  if (code === "REAL_ESTATE_STABILITY") {
    return { displayName: name, displayCode: code, routePath: "/real-estate", linkLabel: "Open page" };
  }
  return { displayName: name, displayCode: code, routePath: `/indicators/${code}`, linkLabel: "View detail" };
}

export default function Indicators() {
  const { data, loading, error, refetch } = useApi<IndicatorStatus[]>("/indicators");

  // Keep internal-only composite contributors off the public indicator table.
  const hiddenCodes = new Set(["AAS", "AAP", "SECTOR_REGIME_ALIGNMENT"]);
  const filteredData = data?.filter(i => !hiddenCodes.has(i.code)) || [];

  if (loading) {
    return (
      <div className="page-shell page-stack">
        <div className="flex flex-col">
          <span className="page-kicker">Diagnostic Library</span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">All Indicators</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stealth-300 md:text-[15px]">Browse each underlying metric, its current state, and the detail view that explains the read.</p>
        </div>
        <div className="flex justify-center py-6">
          <MarketLoading size={96} variant="pulse" label="Loading indicators..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-shell page-stack">
        <div className="flex flex-col">
          <span className="page-kicker">Diagnostic Library</span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">All Indicators</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stealth-300 md:text-[15px]">Browse each underlying metric, its current state, and the detail view that explains the read.</p>
        </div>
        <div className="surface-card rounded-2xl border border-red-700/60 bg-red-950/18 p-4 text-red-200" role="alert">
          <div className="mb-2 font-semibold">Indicators are unavailable.</div>
          <div className="text-sm">{error}</div>
          <button
            type="button"
            onClick={refetch}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-red-700 bg-red-950/60 px-4 text-sm font-semibold text-red-100 hover:bg-red-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            Retry indicators
          </button>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="page-shell page-stack">
        <div className="flex flex-col">
          <span className="page-kicker">Diagnostic Library</span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">All Indicators</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stealth-300 md:text-[15px]">Browse each underlying metric, its current state, and the detail view that explains the read.</p>
        </div>
        <div className="surface-card p-5 text-stealth-300">
          <p>No indicators are available for this update.</p>
          <button type="button" onClick={refetch} className="mt-3 min-h-11 rounded-lg border border-stealth-600 px-4 text-sm font-semibold text-stealth-100 hover:bg-stealth-800">
            Check again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell page-stack">
      <div className="flex flex-col">
        <span className="page-kicker">Diagnostic Library</span>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">All Indicators</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stealth-300 md:text-[15px]">Browse each underlying metric, its current state, and the detail view that explains the read.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-stealth-300">
          <span className="page-badge">{filteredData.length} active rows</span>
          <span className="page-badge">Tap any row for history</span>
        </div>
      </div>

      {/* Desktop Table View */}
      <div
        aria-label="Indicator scores and states. Scroll horizontally if needed."
        className="surface-card-strong hidden max-w-full overflow-x-auto lg:block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        role="region"
        tabIndex={0}
      >
        <table className="w-full">
          <caption className="sr-only">Current indicator scores, states, and detail links</caption>
          <thead className="text-left text-stealth-400">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Trend</th>
            </tr>
          </thead>
          <tbody className="text-stealth-300">
            {filteredData.map((i) => (
              <IndicatorRow key={i.code} indicator={i} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile/Tablet Card View */}
      <div className="grid gap-3 lg:hidden">
        {filteredData.map((i) => (
          <IndicatorCard key={i.code} indicator={i} />
        ))}
      </div>
    </div>
  );
}

function IndicatorRow({ indicator }: { indicator: IndicatorStatus }) {
  const { displayName, displayCode, routePath, linkLabel } = resolveIndicatorDisplay(indicator.code, indicator.name);

  return (
    <tr className="border-t border-stealth-700">
      <td className="px-4 py-3">
        <Link
          to={routePath}
          className="text-accent-yellow hover:underline"
        >
          {displayCode}
        </Link>
      </td>
      <td className="px-4 py-3">{displayName}</td>
      <td className="px-4 py-3 font-mono tabular-nums">{formatNumber(indicator.score, 1)}</td>
      <td className="px-4 py-3">{indicator.state}</td>
      <td className="px-4 py-3">
        <span className="text-stealth-400 text-xs">{linkLabel}</span>
      </td>
    </tr>
  );
}

function IndicatorCard({ indicator }: { indicator: IndicatorStatus }) {
  const { displayName, displayCode, routePath, linkLabel } = resolveIndicatorDisplay(indicator.code, indicator.name);

  return (
    <Link
      to={routePath}
      className="primary-card primary-card-hover block min-h-11 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      <div>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <div className="text-accent-yellow font-semibold text-sm">{displayCode}</div>
            <div className="text-stealth-300 text-xs mt-0.5">{displayName}</div>
          </div>
          <span className="mt-1 inline-flex items-center" aria-label={`State ${indicator.state}`} title={indicator.state}>
            <span className={`h-2.5 w-2.5 rounded-full ${stateDotMap[indicator.state]}`}></span>
          </span>
        </div>
        <div className="flex items-end justify-between">
          <div className="font-mono text-lg font-bold tabular-nums text-stealth-100">Score: {formatNumber(indicator.score, 1)}</div>
        </div>
        <div className="mt-2 text-xs text-stealth-400">{linkLabel === "Open page" ? "Open market page" : "Trend history in detail view"}</div>
      </div>
    </Link>
  );
}
