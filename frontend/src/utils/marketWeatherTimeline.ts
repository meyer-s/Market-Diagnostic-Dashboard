import type {
  MarketWeatherPricePoint,
  MarketWeatherResearch,
} from "../types/marketWeather";

export type MarketTimelineWindow = 60 | 120 | 250 | "all";

export type MarketDirectionalPhase =
  | "positive-strengthening"
  | "positive-fading"
  | "negative-strengthening"
  | "negative-fading"
  | "balanced";

export interface MarketStateTimelinePoint {
  date: string;
  close: number;
  pressure: number | null;
  pressureChange: number | null;
  acceleration: number | null;
  organization: number | null;
  disorder: number | null;
  propagation: number | null;
  volatilityRatio: number | null;
  participationRatio: number | null;
  liquidityRatio: number | null;
  distanceTailScore: number | null;
  outsideLearnedRange: boolean | null;
  stateId: string | null;
  directionalPhase: MarketDirectionalPhase;
}

export interface MarketDirectionalPhaseRun {
  key: string;
  phase: MarketDirectionalPhase;
  start: string;
  end: string;
  duration: number;
  outsideLearnedRange: boolean;
}

export interface MarketLearnedFormRun {
  key: string;
  stateId: string | null;
  start: string;
  end: string;
  duration: number;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function marketDirectionalPhase(
  pressure: number | null | undefined,
  pressureChange: number | null | undefined,
): MarketDirectionalPhase {
  const signedPressure = finite(pressure);
  const signedChange = finite(pressureChange);
  if (signedPressure === null || signedChange === null || Math.abs(signedPressure) < 1e-9) return "balanced";
  const strengthening = signedPressure * signedChange >= 0;
  if (signedPressure > 0) return strengthening ? "positive-strengthening" : "positive-fading";
  return strengthening ? "negative-strengthening" : "negative-fading";
}

export function buildMarketStateTimeline(
  price: MarketWeatherPricePoint[],
  research: MarketWeatherResearch,
): MarketStateTimelinePoint[] {
  const derivatives = new Map(research.derivative_series.map((point) => [point.date, point]));
  const strata = new Map(research.strata.series.map((point) => [point.date, point]));
  const ratios = new Map((research.carriers?.ratios?.series ?? []).map((point) => [point.date, point]));
  const evaluation = new Map((research.lexicon?.evaluation_sequence ?? []).map((point) => [point.date, point]));

  return price.map((pricePoint) => {
    const derivative = derivatives.get(pricePoint.date);
    const stratum = strata.get(pricePoint.date);
    const ratio = ratios.get(pricePoint.date);
    const state = evaluation.get(pricePoint.date);
    const pressure = finite(derivative?.pressure);
    const pressureChange = finite(derivative?.velocity);

    return {
      date: pricePoint.date,
      close: pricePoint.close,
      pressure: pressure === null ? null : pressure * 100,
      pressureChange: pressureChange === null ? null : pressureChange * 100,
      acceleration: finite(derivative?.acceleration),
      organization: finite(stratum?.structure) === null ? null : stratum!.structure * 100,
      disorder: finite(stratum?.information) === null ? null : stratum!.information * 100,
      propagation: finite(stratum?.propagation) === null ? null : stratum!.propagation * 100,
      volatilityRatio: finite(ratio?.realized_volatility),
      participationRatio: finite(ratio?.participation),
      liquidityRatio: finite(ratio?.liquidity_stress),
      distanceTailScore: finite(state?.distance_tail_score),
      outsideLearnedRange: state?.outside_learned_range ?? null,
      stateId: state?.state_id ?? null,
      directionalPhase: marketDirectionalPhase(pressure, pressureChange),
    };
  });
}

export function sliceMarketStateTimeline(
  points: MarketStateTimelinePoint[],
  window: MarketTimelineWindow,
): MarketStateTimelinePoint[] {
  return window === "all" ? points : points.slice(-window);
}

export function buildDirectionalPhaseRuns(
  points: MarketStateTimelinePoint[],
): MarketDirectionalPhaseRun[] {
  const runs: MarketDirectionalPhaseRun[] = [];
  points.forEach((point) => {
    const previous = runs[runs.length - 1];
    const outsideLearnedRange = point.outsideLearnedRange === true;
    if (
      previous
      && previous.phase === point.directionalPhase
      && previous.outsideLearnedRange === outsideLearnedRange
    ) {
      previous.end = point.date;
      previous.duration += 1;
      return;
    }
    runs.push({
      key: `${point.date}-${point.directionalPhase}-${point.stateId ?? "unscored"}`,
      phase: point.directionalPhase,
      start: point.date,
      end: point.date,
      duration: 1,
      outsideLearnedRange,
    });
  });
  return runs;
}

export function buildLearnedFormRuns(points: MarketStateTimelinePoint[]): MarketLearnedFormRun[] {
  const runs: MarketLearnedFormRun[] = [];
  points.forEach((point) => {
    const previous = runs[runs.length - 1];
    if (previous && previous.stateId === point.stateId) {
      previous.end = point.date;
      previous.duration += 1;
      return;
    }
    runs.push({
      key: `${point.date}-${point.stateId ?? "unscored"}`,
      stateId: point.stateId,
      start: point.date,
      end: point.date,
      duration: 1,
    });
  });
  return runs;
}

export function focusedRatioDomain(
  points: MarketStateTimelinePoint[],
  key: "volatilityRatio" | "participationRatio" | "liquidityRatio",
): [number, number] {
  const values = points.map((point) => point[key]).filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return [0.9, 1.1];
  const low = Math.min(1, ...values);
  const high = Math.max(1, ...values);
  const span = Math.max(high - low, 0.1);
  const padding = span * 0.12;
  return [Math.max(0, low - padding), high + padding];
}
