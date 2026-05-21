import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { getFamilyColor } from "../../theme/metricColors";

interface AASComponent {
  name: string;
  category: string;
  value: number;
  weight: number;
  contribution: number;
  status: 'active' | 'missing';
  description: string;
}

interface MetalsSubsystemPanelProps {
  components: AASComponent[];
  contribution: number;
  sharePercent?: number;
  rawHistory?: Record<string, { date: string; value: number | null }[]>;
  smoothedHistory?: Record<string, { date: string; value: number | null }[]>;
}

export function MetalsSubsystemPanel({
  components,
  contribution,
  sharePercent,
  rawHistory = {},
  smoothedHistory = {}
}: MetalsSubsystemPanelProps) {
  const activeCount = components.filter(c => c.status === 'active').length;
  const totalCount = components.length;
  const metalsColor = getFamilyColor("metals");

  return (
    <div className="bg-gradient-to-br from-amber-950/20 to-stealth-850 border border-amber-900/30 rounded-lg p-4 md:p-6">
      <div className="flex items-center gap-3 mb-4">
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20" style={{ color: metalsColor }}>
          <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
        </svg>
        <div className="flex-1">
          <h3 className="text-xl font-semibold" style={{ color: metalsColor }}>Metals Subsystem</h3>
          <div className="text-xs text-stealth-400 mt-0.5">
            Precious metals as monetary hedges & flight-to-safety assets
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold" style={{ color: metalsColor }}>
            {(sharePercent ?? (contribution * 100)).toFixed(1)}%
          </div>
          <div className="text-xs text-stealth-400">{activeCount}/{totalCount} active</div>
        </div>
      </div>

      <div className="space-y-3">
        {components.map((component, idx) => (
          <div key={idx} className="bg-stealth-900/50 border border-stealth-700 rounded-lg p-4 hover:border-amber-900/50 transition-colors">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-stealth-100">{component.name}</span>
                  {component.status === 'active' ? (
                    <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-medium">Active</span>
                  ) : (
                    <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded font-medium">Missing</span>
                  )}
                </div>
                <div className="text-xs text-stealth-400 leading-relaxed">{component.description}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-stealth-700/50">
              <div>
                <div className="text-xs text-stealth-500">Weight</div>
                <div className="text-sm font-semibold text-stealth-200">{(component.weight * 100).toFixed(1)}%</div>
              </div>
              {component.status === 'active' && (
                <>
                  <div>
                    <div className="text-xs text-stealth-500">Value</div>
                    <div className="text-sm font-semibold text-stealth-200">{component.value.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-stealth-500">Contribution</div>
                    <div className="text-sm font-semibold" style={{ color: metalsColor }}>
                      {component.contribution.toFixed(2)}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="mt-3">
              <div className="text-xs text-stealth-500 mb-1">52w trend (raw + smoothed)</div>
              <div className="h-14">
                {(() => {
                  const rawSeries = rawHistory[component.name] || [];
                  const smoothSeries = smoothedHistory[component.name] || [];
                  const values = (rawSeries.length ? rawSeries : smoothSeries)
                    .map(entry => entry.value)
                    .filter((value): value is number => value !== null && value !== undefined);
                  const min = values.length ? Math.min(...values) : 0;
                  const max = values.length ? Math.max(...values) : 1;
                  const range = max - min;
                  const padding = range > 0 ? range * 0.1 : 0.02;
                  const domainMin = Math.max(0, min - padding);
                  const domainMax = Math.min(1, max + padding);
                  const uniqueValues = new Set(values.map(value => Number(value.toFixed(2))));
                  const isStepped = uniqueValues.size <= 4;

                  const rawMap = new Map(rawSeries.map(entry => [entry.date, entry.value]));
                  const smoothMap = new Map(smoothSeries.map(entry => [entry.date, entry.value]));
                  const baseSeries = smoothSeries.length ? smoothSeries : rawSeries;
                  const chartData = baseSeries.map(entry => ({
                    date: entry.date,
                    raw: rawMap.get(entry.date) ?? null,
                    smooth: smoothMap.get(entry.date) ?? null,
                  }));

                  const rawColor = getFamilyColor("metals", "muted");
                  const smoothColor = metalsColor;

                  return (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <LineChart data={chartData}>
                        <YAxis type="number" domain={[domainMin, domainMax]} hide />
                        <Line
                          type={isStepped ? "stepAfter" : "monotone"}
                          dataKey="raw"
                          stroke={rawColor}
                          strokeOpacity={0.45}
                          strokeWidth={1}
                          dot={false}
                          connectNulls
                        />
                        <Line
                          type={isStepped ? "stepAfter" : "monotone"}
                          dataKey="smooth"
                          stroke={smoothColor}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  );
                })()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Summary Stats */}
      <div className="mt-4 p-3 bg-stealth-900/30 border border-amber-900/20 rounded">
        <div className="text-xs text-stealth-400 mb-2">Subsystem Health</div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-stealth-300">
            {activeCount} of {totalCount} components operational
          </span>
          <span className={`text-sm font-semibold ${
            activeCount / totalCount >= 0.7 ? 'text-emerald-400' : 'text-yellow-400'
          }`}>
            {((activeCount / totalCount) * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}
