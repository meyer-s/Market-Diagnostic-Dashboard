/**
 * Sector Alerts Widget
 * 
 * Displays divergence alerts when sector leadership patterns conflict with expected market regime behavior.
 * These alerts can signal regime transitions, recovery opportunities, or early warning signs.
 * 
 * Alert Types:
 * 1. Recovery Signal: Cyclicals leading in RED market (investors positioning for rebound)
 * 2. Flight to Safety: Extreme defensive bias in RED market (panic positioning)
 * 3. Caution Signal: Defensives leading in GREEN market (smart money de-risking)
 * 4. Risk-On Confirmation: Strong cyclical bias in GREEN market (healthy growth environment)
 * 5. Regime Transition: Extreme bias in YELLOW market (potential state change ahead)
 * 
 * Severity Levels:
 * - INFO: Confirming expected behavior or early positioning signals
 * - WARNING: Divergence from expected patterns or extreme positioning
 * 
 * @component
 */

import { useEffect, useState } from "react";
import { apiFetch } from "../../utils/apiUtils";

interface SectorAlert {
  type: string;
  severity: "INFO" | "WARNING";
  title: string;
  message: string;
  details: any;
  timestamp: string;
}

export default function SectorAlertsWidget() {
  const [alerts, setAlerts] = useState<SectorAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const data = await apiFetch<{ alerts?: SectorAlert[] }>("/sectors/alerts");
        setAlerts(data.alerts || []);
      } catch (error) {
        console.error("Failed to fetch sector alerts:", error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 300000); // Refresh every 5 minutes
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="bg-stealth-800 rounded-lg p-6 shadow-lg border border-stealth-700">
        <h3 className="text-lg font-semibold mb-4">Sector Divergence Alerts</h3>
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="bg-stealth-800 rounded-lg p-6 shadow-lg border border-stealth-700">
        <h3 className="text-lg font-semibold mb-4">Sector Divergence Alerts</h3>
        <div className="text-gray-400 text-sm">
          No divergence alerts. Sector positioning aligns with market regime.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-stealth-800 rounded-lg p-6 shadow-lg border border-stealth-700">
      <h3 className="text-lg font-semibold mb-4">Sector Divergence Alerts</h3>
      
      <div className="space-y-3">
        {alerts.map((alert, idx) => (
          <div
            key={idx}
            className={`bg-stealth-900 rounded p-4 border-l-4 ${
              alert.severity === "WARNING" 
                ? "border-yellow-400" 
                : "border-blue-400"
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${
                  alert.severity === "WARNING" ? "text-yellow-400" : "text-blue-400"
                }`}>
                  {alert.severity === "WARNING" ? "⚠" : "ℹ"}
                </span>
                <span className="text-sm font-semibold text-stealth-100">
                  {alert.title}
                </span>
              </div>
            </div>
            
            <p className="text-xs text-gray-300 mb-3">
              {alert.message}
            </p>
            
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-stealth-800 rounded p-2">
                <div className="text-gray-500">System State</div>
                <div className={`font-bold ${
                  alert.details.system_state === "RED" ? "text-red-400" :
                  alert.details.system_state === "GREEN" ? "text-green-400" :
                  "text-yellow-400"
                }`}>
                  {alert.details.system_state}
                </div>
              </div>
              
              <div className="bg-stealth-800 rounded p-2">
                <div className="text-gray-500">Spread</div>
                <div className="font-bold text-stealth-200">
                  {alert.details.spread > 0 ? "+" : ""}{alert.details.spread} pts
                </div>
              </div>
              
              <div className="bg-stealth-800 rounded p-2">
                <div className="text-gray-500">Defensive Avg</div>
                <div className="font-bold text-blue-400">
                  {alert.details.defensive_avg}
                </div>
              </div>
              
              <div className="bg-stealth-800 rounded p-2">
                <div className="text-gray-500">Cyclical Avg</div>
                <div className="font-bold text-orange-400">
                  {alert.details.cyclical_avg}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
