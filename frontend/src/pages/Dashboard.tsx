import { useApi } from "../hooks/useApi";
import { IndicatorStatus } from "../types";
import IndicatorCard from "../components/widgets/IndicatorCard";
import DowTheoryWidget from "../components/widgets/DowTheoryWidget";
import SystemOverviewWidget from "../components/widgets/SystemOverviewWidget";

export default function Dashboard() {
  const { data: indicators } = useApi<IndicatorStatus[]>("/indicators");

  return (
    <div className="p-6 text-gray-200">
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <SystemOverviewWidget />
        <DowTheoryWidget />
      </div>

      <h3 className="text-xl font-semibold mb-4">Indicators</h3>
      <div className="grid grid-cols-3 gap-4">
        {indicators?.map((i) => (
          <IndicatorCard key={i.code} indicator={i} />
        ))}
      </div>
    </div>
  );
}