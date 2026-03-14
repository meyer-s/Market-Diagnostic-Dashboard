import { useApi } from "../hooks/useApi";
import { IndicatorStatus } from "../types";
import { Link } from "react-router-dom";
import { getStateBadgeClass } from "../utils/styleUtils";
import MarketLoading from "../components/ui/MarketLoading";

function resolveIndicatorDisplay(code: string, name: string) {
  if (code === "ANALYST_ANXIETY") {
    return { displayName: "Analyst Confidence", displayCode: "ANALYST_CONFIDENCE", routeCode: "ANALYST_CONFIDENCE" };
  }
  return { displayName: name, displayCode: code, routeCode: code };
}

export default function Indicators() {
  const { data, loading, error } = useApi<IndicatorStatus[]>("/indicators");

  // Filter out AAP (Alternative Asset Stability) since it has its own dedicated page
  const filteredData = data?.filter(i => i.code !== "AAP") || [];

  if (loading) {
    return (
      <div className="p-3 md:p-6 text-gray-200">
        <h2 className="text-xl sm:text-2xl font-bold mb-3 md:mb-4">All Indicators</h2>
        <div className="flex justify-center py-6">
          <MarketLoading size={96} variant="pulse" label="Loading indicators..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 md:p-6 text-gray-200">
        <h2 className="text-xl sm:text-2xl font-bold mb-3 md:mb-4">All Indicators</h2>
        <div className="bg-red-900/20 border border-red-700 text-red-200 p-4 rounded">
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
      <div className="p-3 md:p-6 text-gray-200">
        <h2 className="text-xl sm:text-2xl font-bold mb-3 md:mb-4">All Indicators</h2>
        <div className="text-stealth-400">No indicators available.</div>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-6 text-gray-200">
      <h2 className="text-xl sm:text-2xl font-bold mb-3 md:mb-4">All Indicators</h2>

      {/* Desktop Table View */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full bg-stealth-800 rounded">
          <thead className="text-left text-gray-400">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Trend</th>
            </tr>
          </thead>
          <tbody className="text-gray-300">
            {filteredData.map((i) => (
              <IndicatorRow key={i.code} indicator={i} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile/Tablet Card View */}
      <div className="lg:hidden space-y-3">
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
      <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-3 hover:bg-stealth-750 transition">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="text-accent-yellow font-semibold text-sm">{displayCode}</div>
            <div className="text-stealth-300 text-xs mt-0.5">{displayName}</div>
          </div>
          <div className={getStateBadgeClass(indicator.state)}>
            {indicator.state}
          </div>
        </div>
        <div className="flex items-end justify-between">
          <div className="text-lg font-bold text-stealth-100">Score: {indicator.score}</div>
        </div>
        <div className="mt-2 text-xs text-stealth-400">Trend history in detail view</div>
      </div>
    </Link>
  );
}
