import { useState, useEffect } from "react";
import { apiFetch } from "../../utils/apiUtils";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from "recharts";
import { CHART_NEUTRAL } from "../../utils/chartUtils";
import { getMetricColor } from "../../theme/metricColors";

interface MetalProjection {
  metal: string;
  metal_name: string;
  current_price: number;
  score_total: number;
  classification: string;
  relative_classification: "Winner" | "Neutral" | "Loser";
  technicals: {
    momentum_20d: number | null;
  };
}

interface RegimeStatus {
  overall_regime: string;
  gold_bias: string;
  paper_physical_risk: string;
}

const getMetalColor = (metal: string) => getMetricColor(metal);

export default function PreciousMetalsWidget() {
  const [projections, setProjections] = useState<MetalProjection[]>([]);
  const [regime, setRegime] = useState<RegimeStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [projectionsData, regimeData] = await Promise.all([
          apiFetch<{ projections?: MetalProjection[] }>("/precious-metals/projections/latest"),
          apiFetch<{ regime?: RegimeStatus | null }>("/precious-metals/regime"),
        ]);

        setProjections(projectionsData.projections || []);
        setRegime(regimeData.regime || null);
      } catch (error) {
        console.error("Error fetching metals data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const getRegimeColor = (regime: string) => {
    if (regime.includes("MONETARY") || regime.includes("INFLATION")) return "text-yellow-400";
    if (regime.includes("GROWTH")) return "text-green-400";
    if (regime.includes("CRISIS")) return "text-red-400";
    return "text-blue-400";
  };

  const getClassColor = (classification: "Winner" | "Neutral" | "Loser") => {
    if (classification === "Winner") return "text-emerald-400";
    if (classification === "Loser") return "text-red-400";
    return "text-blue-400";
  };

  const chartData = projections.map(p => ({
    metal: p.metal,
    score: p.score_total,
    color: getMetalColor(p.metal)
  }));

  if (loading) {
    return (
      <div className="primary-card p-4 md:p-6">
        <h3 className="text-base sm:text-lg font-bold mb-3">Precious Metals</h3>
        <div className="text-sm text-stealth-400">Loading...</div>
      </div>
    );
  }

  return (
    <Link 
      to="/precious-metals"
      className="primary-card primary-card-hover p-4 md:p-6 cursor-pointer block"
    >
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-base sm:text-lg font-bold">Precious Metals</h3>
        {regime && (
          <span className={`text-xs font-semibold ${getRegimeColor(regime.overall_regime)}`}>
            {regime.overall_regime.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {/* Score Chart */}
      {chartData.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-stealth-400 mb-2">Technical Scores (0-100)</div>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={chartData}>
              <XAxis 
                dataKey="metal" 
                tick={{ fill: CHART_NEUTRAL.tick, fontSize: 11 }}
                axisLine={false}
              />
              <YAxis 
                domain={[0, 100]}
                tick={{ fill: CHART_NEUTRAL.tick, fontSize: 10 }}
                axisLine={false}
                width={30}
              />
              <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Metal Rankings */}
      <div className="space-y-2 mb-4">
        {projections.slice(0, 4).map((proj) => (
          <div key={proj.metal} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 flex-1">
              <span 
                className="font-semibold"
                style={{ color: getMetalColor(proj.metal) }}
              >
                {proj.metal}
              </span>
              <span className="text-stealth-400 text-xs">${proj.current_price.toFixed(0)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold ${
                (proj.technicals.momentum_20d || 0) >= 0 ? "text-green-400" : "text-red-400"
              }`}>
                {proj.technicals.momentum_20d !== null 
                  ? `${proj.technicals.momentum_20d > 0 ? "+" : ""}${proj.technicals.momentum_20d.toFixed(1)}%`
                  : "N/A"}
              </span>
              <span className={`text-xs ${getClassColor(proj.relative_classification)}`}>
                {proj.relative_classification}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Stats */}
      {regime && (
        <div className="pt-3 border-t border-stealth-700 grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-stealth-400">Gold Bias:</span>
            <div className="font-semibold text-stealth-200 mt-0.5">
              {regime.gold_bias.replace(/_/g, " ")}
            </div>
          </div>
          <div>
            <span className="text-stealth-400">Paper Risk:</span>
            <div className={`font-semibold mt-0.5 ${
              regime.paper_physical_risk === "HIGH" ? "text-red-400" :
              regime.paper_physical_risk === "MODERATE" ? "text-yellow-400" : "text-green-400"
            }`}>
              {regime.paper_physical_risk}
            </div>
          </div>
        </div>
      )}
    </Link>
  );
}
