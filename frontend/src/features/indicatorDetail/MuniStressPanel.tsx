import React from "react";

import EvidenceStateNotice from "../../components/ui/EvidenceStateNotice";
import { ComponentChart } from "../../components/widgets/ComponentChart";
import { getFamilyColor, statePalette } from "../../theme/metricColors";
import {
  muniPublicSectorThresholds,
  muniPublicSectorWeights,
} from "../../theme/metricRegistry";
import { processComponentData } from "../../utils/chartDataUtils";
import {
  describeDataQuality,
  mergeDataQualityEvidenceState,
} from "../../utils/dataQuality";
import type { EvidenceState } from "../../utils/evidenceState";
import type { MuniSubsystemResponse } from "./types";

interface MuniStressPanelProps {
  data: MuniSubsystemResponse | null;
  loading: boolean;
  error: string | null;
  chartRangeDays: number;
}

interface MuniChartRow {
  date: string;
  curve_score?: number | null;
  curve_level?: number | null;
  curve_slope?: number | null;
  [key: string]: string | number | null | undefined;
}

export default function MuniStressPanel({
  data,
  loading,
  error,
  chartRangeDays,
}: MuniStressPanelProps) {
  if (loading) {
    return (
      <EvidenceStateNotice
        panelId="bond-public-credit"
        title="Public-sector credit evidence"
        state="loading"
        message="Loading municipal credit and public-finance funding evidence."
        className="mb-6"
      />
    );
  }

  if (error) {
    return (
      <EvidenceStateNotice
        panelId="bond-public-credit"
        title="Public-sector credit evidence"
        state="error"
        message={`Municipal subsystem evidence is unavailable: ${error}`}
        className="mb-6"
      />
    );
  }

  if (!data || !data.series || data.series.length === 0) {
    return (
      <EvidenceStateNotice
        panelId="bond-public-credit"
        title="Public-sector credit evidence"
        state="empty"
        message="The municipal subsystem request completed without observations."
        className="mb-6"
      />
    );
  }

  const formatValue = (value: number | null | undefined, unit?: string) => {
    if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
    if (unit === "percent") return `${value.toFixed(2)}%`;
    return value.toFixed(2);
  };

  const trendClass = (trend?: string) => {
    switch (trend) {
      case "improving":
        return "text-green-400";
      case "worsening":
      case "deteriorating":
        return "text-red-400";
      case "stable":
        return "text-stealth-300";
      default:
        return "text-stealth-500";
    }
  };

  const seriesColors = (key: string) => {
    switch (key) {
      case "MUNI_LONG_SPREAD":
        return getFamilyColor("credit");
      case "SIFMA_INDEX":
        return getFamilyColor("liquidity");
      case "MUNI_CURVE_SLOPE_STABILITY":
        return getFamilyColor("rates");
      case "MUNI_REVENUE_PROXY":
        return getFamilyColor("system");
      default:
        return getFamilyColor("system");
    }
  };

  const hasLineData = (rows: object[], dataKey: string, minPoints = 2) => {
    let count = 0;
    for (const row of rows) {
      const value = (row as Record<string, unknown>)?.[dataKey];
      if (Number.isFinite(value)) {
        count += 1;
        if (count >= minPoints) return true;
      }
    }
    return false;
  };

  const orderedSeries = React.useMemo(() => {
    const weightMap = muniPublicSectorWeights;
    return [...data.series].sort((a, b) => {
      const weightA = weightMap[a.key as keyof typeof weightMap] ?? 0;
      const weightB = weightMap[b.key as keyof typeof weightMap] ?? 0;
      if ((a.is_live ?? true) !== (b.is_live ?? true)) {
        return (b.is_live ? 1 : 0) - (a.is_live ? 1 : 0);
      }
      return weightB - weightA;
    });
  }, [data.series]);

  const combined = React.useMemo(() => {
    const map = new Map<string, MuniChartRow>();
    data.series.forEach((series) => {
      series.history?.forEach((point) => {
        if (!point?.date) return;
        const existing = map.get(point.date) || { date: point.date };
        existing[`${series.key}_score`] = point.stability_score;
        map.set(point.date, existing);
      });
    });

    if (data.curve?.history) {
      data.curve.history.forEach((point) => {
        if (!point?.date) return;
        const existing = map.get(point.date) || { date: point.date };
        existing.curve_score = point.score;
        existing.curve_level = point.level;
        existing.curve_slope = point.slope;
        map.set(point.date, existing);
      });
    }

    return Array.from(map.values()).sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [data]);

  const { data: chartData, dateRange } = processComponentData(combined, chartRangeDays);
  const missingSeries = data.series.filter((series) => !(series.history && series.history.length > 0));
  const hasCurveLevel = hasLineData(chartData, "curve_level");
  const hasCurveSlope = hasLineData(chartData, "curve_slope");
  const hasCurveScore = hasLineData(chartData, "curve_score");
  const structuralEvidenceState: EvidenceState =
    missingSeries.length > 0 ||
    Boolean(data.composite?.missing_keys?.length) ||
    data.curve?.status === "unavailable"
      ? "partial"
      : "complete";
  const muniEvidenceState = mergeDataQualityEvidenceState(
    structuralEvidenceState,
    data.data_quality,
  );
  const provenanceMessage = describeDataQuality(
    "public-sector credit",
    data.data_quality,
  );

  return (
    <div
      className="bg-stealth-800 border border-stealth-700 rounded-lg p-4 md:p-6 mb-6"
      data-evidence-panel="bond-public-credit"
      data-evidence-state={muniEvidenceState}
      aria-label={`Public-sector credit evidence: ${muniEvidenceState}`}
    >
      <div className="flex items-start justify-between flex-col gap-2 md:flex-row md:items-center mb-4">
        <div>
          <h3 className="text-lg md:text-xl font-semibold text-stealth-100">
            Public-sector credit &amp; funding stress
          </h3>
          <p className="text-xs md:text-sm text-stealth-400 mt-1 max-w-3xl">
            Isolates tax-exempt and public-finance funding conditions using public,
            derived proxies rather than proprietary municipal curve feeds.
          </p>
          <p className="text-xs text-stealth-500 mt-2 max-w-3xl">
            This public-sector view is a critical companion to the core bond composite, and in a richer
            dataset the two would be expected to move together. Because proxy inputs are limited and
            can be brittle, we do not compute a divergence metric today. If higher-quality data were
            available, the spread between these lines would be a more direct read on relative health.
          </p>
          <p
            className={`mt-2 text-xs font-semibold uppercase tracking-[0.12em] ${
              muniEvidenceState === "complete" ? "text-emerald-300" : "text-amber-300"
            }`}
          >
            {muniEvidenceState === "complete"
              ? "Complete evidence"
              : muniEvidenceState === "stale"
                ? "Stale snapshot"
                : "Partial evidence"}
          </p>
          {provenanceMessage && (
            <p className="mt-2 max-w-3xl text-xs leading-5 text-amber-200">
              {provenanceMessage}
            </p>
          )}
        </div>
        <div className="text-xs text-stealth-500">
          {data.as_of && <div>As of {data.as_of}</div>}
          {data.composite && (
            <div className="mt-1">
              Coverage: {data.composite.coverage_live}/{data.composite.coverage_total}
              {data.composite.missing_keys?.length > 0 && (
                <span className="text-amber-400"> (missing: {data.composite.missing_keys.join(", ")})</span>
              )}
            </div>
          )}
        </div>
      </div>

      {data.relationship_signal && data.relationship_signal.state !== "GREEN" && (
        <div className="data-card mb-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-stealth-400">{data.relationship_signal.name}</div>
            <div
              className={`text-xs font-semibold ${
                data.relationship_signal.state === "RED"
                  ? "text-red-400"
                  : "text-yellow-400"
              }`}
            >
              {data.relationship_signal.state}
            </div>
          </div>
          {data.relationship_signal.message && (
            <div className="text-xs text-stealth-300 mt-2">
              {data.relationship_signal.message}
            </div>
          )}
        </div>
      )}

      {data.composite && (
        <div className="data-card mb-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-stealth-400">Composite Stability</div>
            <div className="text-xs text-stealth-500">
              Green ≥ {muniPublicSectorThresholds.green}, Yellow ≥ {muniPublicSectorThresholds.yellow}
            </div>
          </div>
          <div className="flex items-baseline gap-3 mt-1">
            <div className="text-2xl font-bold text-stealth-100">
              {data.composite.score !== null && data.composite.score !== undefined
                ? data.composite.score.toFixed(1)
                : "n/a"}
            </div>
            <div
              className={`text-sm font-semibold ${
                data.composite.state === "GREEN"
                  ? "text-green-400"
                  : data.composite.state === "YELLOW"
                  ? "text-yellow-400"
                  : data.composite.state === "RED"
                  ? "text-red-400"
                  : "text-stealth-400"
              }`}
            >
              {data.composite.state}
              {data.composite.near_threshold ? " ±" : ""}
            </div>
          </div>
          {data.composite.near_threshold && (
            <div className="text-xs text-amber-400 mt-1">
              Near {data.composite.near_threshold} boundary
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 mb-6">
        {orderedSeries.map((series) => (
          <div
            key={series.key}
            className="data-card"
            data-evidence-panel={`bond-public-${series.key.toLowerCase().replace(/_/g, "-")}`}
            data-evidence-state={series.history && series.history.length > 0 ? "complete" : "empty"}
            role={series.history && series.history.length > 0 ? undefined : "status"}
          >
            <div className="flex items-center justify-between">
              <div className="text-xs text-stealth-400 mb-1">{series.label}</div>
              <div className="flex items-center gap-2">
                {series.is_live === false && (
                  <span className="text-xs text-stealth-300 bg-stealth-500/10 border border-stealth-500/30 px-2 py-0.5 rounded-full">
                    archived
                  </span>
                )}
                {series.is_proxy && (
                <span className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
                  proxy
                </span>
                )}
              </div>
            </div>
            <div className="text-lg font-bold" style={{ color: seriesColors(series.key) }}>
              {formatValue(series.latest?.value ?? null, series.unit)}
            </div>
            <div className="text-xs text-stealth-500 mt-1">
              Stability: {series.latest?.stability_score !== null && series.latest?.stability_score !== undefined ? series.latest?.stability_score.toFixed(0) : "n/a"}
            </div>
            <div className={`text-xs mt-1 ${trendClass(series.trend)}`}>
              Trend: {series.trend || "n/a"}
            </div>
            {series.stress_cues?.stress_level && series.stress_cues.stress_level !== "normal" && (
              <div className={`text-xs mt-1 ${series.stress_cues.stress_level === "severe" ? "text-red-400" : "text-amber-300"}`}>
                {series.stress_cues.stress_level === "severe" ? "Severe stress cue" : "Stress cue"}
              </div>
            )}
            {series.notes && (
              <div className="text-xs text-stealth-500 mt-2">{series.notes}</div>
            )}
          </div>
        ))}
      </div>

      {missingSeries.length > 0 && (
        <div className="text-xs text-stealth-500 mb-5">
          No recent data available for: {missingSeries.map((series) => series.label).join(", ")}.
        </div>
      )}

      <div className="data-card mb-6 text-xs text-stealth-400">
        <div className="text-stealth-200 font-semibold mb-2">Methodology (summary)</div>
        <div>
          Components &amp; default weights: Long-end stress proxy {(muniPublicSectorWeights.MUNI_LONG_SPREAD * 100).toFixed(0)}% ·
          SIFMA {(muniPublicSectorWeights.SIFMA_INDEX * 100).toFixed(0)}% · Slope Stability {(muniPublicSectorWeights.MUNI_CURVE_SLOPE_STABILITY * 100).toFixed(0)}% ·
          Revenue Proxy {(muniPublicSectorWeights.MUNI_REVENUE_PROXY * 100).toFixed(0)}%.
          Missing live inputs are dropped and remaining weights re-normalized.
        </div>
        <div className="mt-2">
          Long-end stress proxy uses Revdex drawdowns and volatility; curve stability uses a Treasury proxy curve.
          Stability scoring uses rolling z-scores with direction adjustment, mapped to 0–100.
          Composite states: Green ≥ {muniPublicSectorThresholds.green}, Yellow ≥ {muniPublicSectorThresholds.yellow}, Red &lt; {muniPublicSectorThresholds.yellow}.
        </div>
      </div>

      <div className="h-80 mb-6">
        <h4 className="text-sm font-semibold mb-2 text-stealth-200">Municipal Stability Scores</h4>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-stealth-400">
            No history available
          </div>
        ) : (
          <ComponentChart
            data={chartData}
            lines={[
              ...data.series.map((series) => ({
                dataKey: `${series.key}_score`,
                name: series.label,
                stroke: seriesColors(series.key),
                conditional: (rows: object[]) => hasLineData(rows, `${series.key}_score`),
                connectNulls: true,
              })),
              ...(data.curve && data.curve.status !== "unavailable"
                ? [{
                    dataKey: "curve_score",
                    name: data.curve.label || "Muni Yield Curve",
                    stroke: getFamilyColor("system"),
                    strokeWidth: 3,
                    conditional: () => hasCurveScore,
                    connectNulls: true,
                  }]
                : []),
            ]}
            referenceLines={[
              { y: muniPublicSectorThresholds.green, stroke: statePalette.green, label: "GREEN", labelFill: statePalette.green },
              { y: muniPublicSectorThresholds.yellow, stroke: statePalette.red, label: "RED", labelFill: statePalette.red },
            ]}
            yAxisLabel="Stability Score (0-100)"
            yAxisDomain={[0, 100]}
            dateRange={dateRange}
          />
        )}
      </div>

      {data.curve?.status === "unavailable" ? (
        <div
          className="data-card text-xs text-stealth-400"
          data-evidence-panel="bond-public-yield-curve"
          data-evidence-state="error"
          role="status"
        >
          Yield curve data unavailable: {data.curve.reason}
        </div>
      ) : data.curve?.history && data.curve.history.length > 0 ? (
        <div
          className="h-80"
          data-evidence-panel="bond-public-yield-curve"
          data-evidence-state="complete"
        >
          <h4 className="text-sm font-semibold mb-2 text-stealth-200">
            Municipal Yield Curve Structure (Level &amp; Slope)
          </h4>
          <ComponentChart
            data={chartData}
            lines={[
              {
                dataKey: "curve_level",
                name: "Long-End Level",
                stroke: getFamilyColor("rates"),
                conditional: () => hasCurveLevel,
                connectNulls: true,
              },
              {
                dataKey: "curve_slope",
                name: "10y-2y Slope",
                stroke: getFamilyColor("growth"),
                conditional: () => hasCurveSlope,
                connectNulls: true,
              },
            ]}
            yAxisLabel="Yield (%)"
            dateRange={dateRange}
          />
        </div>
      ) : (
        <div
          className="data-card text-xs text-stealth-400"
          data-evidence-panel="bond-public-yield-curve"
          data-evidence-state="empty"
          role="status"
        >
          Municipal yield-curve evidence was not included in this response.
        </div>
      )}
    </div>
  );
}
