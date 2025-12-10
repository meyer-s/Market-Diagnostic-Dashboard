import { useApi } from "../hooks/useApi";
import { IndicatorStatus, IndicatorHistoryPoint } from "../types";
import { Link } from "react-router-dom";
import StateSparkline from "../components/widgets/StateSparkline";

export default function Indicators() {
  const { data } = useApi<IndicatorStatus[]>("/indicators");

  return (
    <div className="p-6 text-gray-200">
      <h2 className="text-2xl font-bold mb-4">All Indicators</h2>

      <table className="w-full bg-stealth-800 rounded">
        <thead className="text-left text-gray-400">
          <tr>
            <th className="px-4 py-3">Code</th>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Score</th>
            <th className="px-4 py-3">State</th>
            <th className="px-4 py-3">Trend (60 days)</th>
          </tr>
        </thead>
        <tbody className="text-gray-300">
          {data?.map((i) => (
            <IndicatorRow key={i.code} indicator={i} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IndicatorRow({ indicator }: { indicator: IndicatorStatus }) {
  const { data: history } = useApi<IndicatorHistoryPoint[]>(
    `/indicators/${indicator.code}/history?days=60`
  );

  return (
    <tr className="border-t border-stealth-700">
      <td className="px-4 py-3">
        <Link
          to={`/indicators/${indicator.code}`}
          className="text-accent-yellow hover:underline"
        >
          {indicator.code}
        </Link>
      </td>
      <td className="px-4 py-3">{indicator.name}</td>
      <td className="px-4 py-3">{indicator.score}</td>
      <td className="px-4 py-3">{indicator.state}</td>
      <td className="px-4 py-3">
        <StateSparkline history={history || []} width={200} height={24} />
      </td>
    </tr>
  );
}