import { useApi } from "../hooks/useApi";
import { IndicatorStatus } from "../types";
import { Link } from "react-router-dom";
import MarketLoading from "../components/ui/MarketLoading";

const stateDotMap = {
  GREEN: "bg-accent-green",
  YELLOW: "bg-accent-yellow",
  RED: "bg-accent-red",
};

function resolveIndicatorDisplay(code: string, name: string) {
  if (code === "ANALYST_ANXIETY") {
    return { displayName: "Analyst Confidence", displayCode: "ANALYST_CONFIDENCE", routeCode: "ANALYST_CONFIDENCE" };
  }
  return { displayName: name, displayCode: code, routeCode: code };
}

export default function Indicators() {
  const { data, loading, error } = useApi<IndicatorStatus[]>("/indicators");

  // Keep internal-only composite contributors off the public indicator table.
  const hiddenCodes = new Set(["AAS", "AAP", "SECTOR_REGIME_ALIGNMENT"]);
  const filteredData = data?.filter(i => !hiddenCodes.has(i.code)) || [];

  if (loading) {
    return (
      <div className="page-shell page-stack">
        <div className="flex flex-col">
          <span className="page-kicker">Diagnostic Library</span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">All Indicators</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 md:text-[15px]">Browse each underlying metric, its current state, and the detail view that explains the read.</p>
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
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">All Indicators</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 md:text-[15px]">Browse each underlying metric, its current state, and the detail view that explains the read.</p>
        </div>
        <div className="surface-card rounded-2xl border border-red-700/60 bg-red-950/18 p-4 text-red-200">
          <div className="font-semibold mb-2">Error loading indicators:</div>
          <div className="text-sm">{error}</div>
          <div className="text-xs mt-2 text-red-400">
            Check console for details or try refreshing the page.
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="page-shell page-stack">
        <div className="flex flex-col">
          <span className="page-kicker">Diagnostic Library</span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">All Indicators</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 md:text-[15px]">Browse each underlying metric, its current state, and the detail view that explains the read.</p>
        </div>
        <div className="text-stealth-400">No indicators available.</div>
      </div>
    );
  }

  return (
    <div className="page-shell page-stack">
      <div className="flex flex-col">
        <span className="page-kicker">Diagnostic Library</span>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">All Indicators</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 md:text-[15px]">Browse each underlying metric, its current state, and the detail view that explains the read.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <span className="page-badge">{filteredData.length} active rows</span>
          <span className="page-badge">Tap any row for history</span>
        </div>
      </div>

      {/* Desktop Table View */}
      <div className="surface-card-strong hidden overflow-x-auto overflow-hidden lg:block">
        <table className="w-full">
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
  const { displayName, displayCode, routeCode } = resolveIndicatorDisplay(indicator.code, indicator.name);

  return (
    <tr className="border-t border-stealth-700">
      <td className="px-4 py-3">
        <Link
          to={`/indicators/${routeCode}`}
          className="text-accent-yellow hover:underline"
        >
          {displayCode}
        </Link>
      </td>
      <td className="px-4 py-3">{displayName}</td>
      <td className="px-4 py-3">{indicator.score}</td>
      <td className="px-4 py-3">{indicator.state}</td>
      <td className="px-4 py-3">
        <span className="text-stealth-400 text-xs">View detail</span>
      </td>
    </tr>
  );
}

function IndicatorCard({ indicator }: { indicator: IndicatorStatus }) {
  const { displayName, displayCode, routeCode } = resolveIndicatorDisplay(indicator.code, indicator.name);

  return (
    <Link to={`/indicators/${routeCode}`}>
      <div className="primary-card primary-card-hover p-3">
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
          <div className="text-lg font-bold text-stealth-100">Score: {indicator.score}</div>
        </div>
        <div className="mt-2 text-xs text-stealth-400">Trend history in detail view</div>
      </div>
    </Link>
  );
}
