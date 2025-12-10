import { useApi } from "../hooks/useApi";

interface Alert {
  id: number;
  timestamp: string;
  type: string;
  message: string;
  affected_indicators: string[];
}

export default function Alerts() {
  const { data: alerts, loading } = useApi<Alert[]>("/alerts?hours=168");

  if (loading) {
    return (
      <div className="p-6 text-gray-200">
        <h2 className="text-2xl font-bold mb-6">Alerts</h2>
        <p>Loading alerts...</p>
      </div>
    );
  }

  return (
    <div className="p-6 text-gray-200">
      <h2 className="text-2xl font-bold mb-6">Market Stability Alerts</h2>
      <p className="text-gray-400 mb-6">
        Showing alerts from the last 7 days. Alerts trigger when 2 or more indicators turn RED.
      </p>

      {alerts && alerts.length === 0 && (
        <div className="bg-green-900/20 border border-green-700 text-green-200 p-4 rounded">
          ✓ No alerts at this time. Market conditions are stable.
        </div>
      )}

      {alerts && alerts.length > 0 && (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="bg-red-900/20 border border-red-700 p-4 rounded"
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-red-200 font-semibold text-lg">
                    🚨 {alert.message}
                  </div>
                  <div className="text-gray-400 text-sm mt-1">
                    {new Date(alert.timestamp).toLocaleString()}
                  </div>
                  {alert.affected_indicators && alert.affected_indicators.length > 0 && (
                    <div className="mt-2">
                      <span className="text-gray-300">Affected indicators: </span>
                      <span className="text-red-300">
                        {alert.affected_indicators.join(", ")}
                      </span>
                    </div>
                  )}
                </div>
                <span className="bg-red-700 text-red-100 px-3 py-1 rounded text-sm">
                  {alert.type}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}