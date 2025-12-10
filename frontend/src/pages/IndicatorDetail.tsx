import { useParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { IndicatorHistoryPoint } from "../types";
import StateSparkline from "../components/widgets/StateSparkline";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface IndicatorMetadata {
  name: string;
  description: string;
  relevance: string;
  scoring: string;
  typical_range: string;
  impact: string;
}

interface IndicatorDetailResponse {
  code: string;
  name: string;
  latest?: {
    timestamp: string;
    raw_value: number;
    normalized_value: number;
    score: number;
    state: "GREEN" | "YELLOW" | "RED";
  };
  metadata?: IndicatorMetadata;
  has_data?: boolean;
}

export default function IndicatorDetail() {
  const { code } = useParams();
  const { data: meta } = useApi<IndicatorDetailResponse>(`/indicators/${code}`);
  const { data: history } = useApi<IndicatorHistoryPoint[]>(
    `/indicators/${code}/history?days=365`
  );

  if (!code) return <div className="p-6 text-gray-200">No code provided.</div>;

  const stateColor = {
    GREEN: "text-green-400 bg-green-500/10 border-green-500/30",
    YELLOW: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    RED: "text-red-400 bg-red-500/10 border-red-500/30",
  };

  return (
    <div className="p-6 text-gray-200 max-w-7xl">
      <h2 className="text-3xl font-bold mb-6">
        {meta?.name ?? code}
      </h2>

      {/* Metadata Section */}
      {meta?.metadata && (
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6 mb-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-stealth-100 mb-2">Description</h3>
            <p className="text-stealth-300 leading-relaxed">{meta.metadata.description}</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-semibold text-stealth-200 mb-1">Relevance</h4>
              <p className="text-sm text-stealth-400">{meta.metadata.relevance}</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-stealth-200 mb-1">Impact</h4>
              <p className="text-sm text-stealth-400">{meta.metadata.impact}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-semibold text-stealth-200 mb-1">Scoring Method</h4>
              <p className="text-sm text-stealth-400">{meta.metadata.scoring}</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-stealth-200 mb-1">Typical Range</h4>
              <p className="text-sm text-stealth-400">{meta.metadata.typical_range}</p>
            </div>
          </div>
        </div>
      )}

      {/* Current Status */}
      {meta?.latest && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4">
            <div className="text-sm text-stealth-400 mb-1">Current Value</div>
            <div className="text-2xl font-bold text-stealth-100">
              {meta.latest.raw_value.toFixed(2)}
            </div>
          </div>
          
          <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4">
            <div className="text-sm text-stealth-400 mb-1">Stability Score</div>
            <div className="text-2xl font-bold text-stealth-100">
              {meta.latest.score}
              <span className="text-sm text-stealth-400 ml-1">/ 100</span>
            </div>
          </div>
          
          <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-4">
            <div className="text-sm text-stealth-400 mb-1">Current State</div>
            <div className={`inline-block px-3 py-1 rounded-full border font-semibold ${
              meta.latest.state ? stateColor[meta.latest.state] : ""
            }`}>
              {meta.latest.state}
            </div>
            <div className="text-xs text-stealth-400 mt-2">
              {new Date(meta.latest.timestamp).toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Historical Charts */}
      <div className="space-y-6">
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-4 text-stealth-100">Raw Value History (365 days)</h3>
          <div className="h-80">
            {history && history.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={(v: string | number) =>
                      new Date(v).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })
                    }
                    tick={{ fill: "#a4a4b0", fontSize: 12 }}
                    stroke="#555560"
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fill: "#a4a4b0", fontSize: 12 }}
                    stroke="#555560"
                    label={{ value: 'Raw Value', angle: -90, position: 'insideLeft', fill: '#a4a4b0' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#161619",
                      borderColor: "#555560",
                      borderRadius: "8px",
                      padding: "12px",
                    }}
                    labelStyle={{ color: "#a4a4b0", marginBottom: "8px" }}
                    itemStyle={{ color: "#ffffff" }}
                    formatter={(value: number) => [value.toFixed(2), "Value"]}
                    labelFormatter={(label: string | number) =>
                      new Date(label).toLocaleDateString()
                    }
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="raw_value"
                    stroke="#60a5fa"
                    strokeWidth={2}
                    dot={false}
                    animationDuration={300}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-stealth-400">
                No history available
              </div>
            )}
          </div>
        </div>

        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-4 text-stealth-100">Stability Score History (365 days)</h3>
          <div className="h-80">
            {history && history.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333338" />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={(v: string | number) =>
                      new Date(v).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })
                    }
                    tick={{ fill: "#a4a4b0", fontSize: 12 }}
                    stroke="#555560"
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "#a4a4b0", fontSize: 12 }}
                    stroke="#555560"
                    label={{ value: 'Score (0-100)', angle: -90, position: 'insideLeft', fill: '#a4a4b0' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#161619",
                      borderColor: "#555560",
                      borderRadius: "8px",
                      padding: "12px",
                    }}
                    labelStyle={{ color: "#a4a4b0", marginBottom: "8px" }}
                    itemStyle={{ color: "#ffffff" }}
                    formatter={(value: number) => {
                      const score = Number(value);
                      const state = score < 30 ? "RED" : score < 60 ? "YELLOW" : "GREEN";
                      return [
                        <span key="value">
                          {score.toFixed(0)} <span className="text-stealth-400">({state})</span>
                        </span>,
                        "Score"
                      ];
                    }}
                    labelFormatter={(label: string | number) =>
                      new Date(label).toLocaleDateString()
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    animationDuration={300}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-stealth-400">
                No history available
              </div>
            )}
          </div>
        </div>

        {/* State Trend Sparkline */}
        <div className="bg-stealth-800 border border-stealth-700 rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-4 text-stealth-100">State Trend (365 days)</h3>
          <div className="flex items-center justify-center py-8">
            <StateSparkline history={history || []} width={800} height={40} />
          </div>
          <div className="flex justify-center gap-6 mt-4 text-sm text-stealth-400">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span>Green (Stable)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <span>Yellow (Caution)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <span>Red (Stress)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}