import type { SummaryInput } from "../types/holisticSummary";

type CandleLike = {
  close: number;
  high: number;
  low: number;
  volume?: number;
};

type FundamentalPointLike = {
  date: string;
  value: number;
};

type FundamentalSeriesLike = {
  series?: FundamentalPointLike[];
};

export type FundamentalsLike = {
  eps?: FundamentalSeriesLike;
  roe?: FundamentalSeriesLike;
  free_cash_flow?: FundamentalSeriesLike;
  market_cap?: FundamentalSeriesLike;
  pe_ratio?: FundamentalSeriesLike;
  revenue?: FundamentalSeriesLike;
  revenue_yoy?: FundamentalSeriesLike;
};

export type OptionalityLike = {
  iv30?: number | null;
  hv30?: number | null;
  iv_percentile?: number | null;
  avg_edr?: number | null;
};

export type TechnicalDataLike = {
  candles?: Array<{ close: number | string; high: number | string; low: number | string; volume?: number | string }>;
  current_price?: number | null;
  sma_50?: number | null;
  sma_200?: number | null;
  rsi?: { series?: Array<number | null>; current?: number | null };
  macd?: { histogram_series?: Array<number | null>; current?: number | null; signal?: number | null; histogram?: number | null };
};

type BuildSummaryInputParams = {
  symbol: string;
  technicalData: TechnicalDataLike;
  fundamentals?: FundamentalsLike | null;
  optionalityMetrics?: OptionalityLike | null;
  asOf?: string | null;
};

const calcSmaSeries = (values: number[], window: number) => {
  if (values.length < window) return Array(values.length).fill(null);
  const result: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= window) {
      sum -= values[i - window];
    }
    result.push(i >= window - 1 ? sum / window : null);
  }
  return result;
};

const calcSlopeFromSeries = (series: Array<number | null>, window = 10) => {
  const values = series.filter((value): value is number => Number.isFinite(value));
  if (values.length <= window) return null;
  return (values[values.length - 1] - values[values.length - 1 - window]) / window;
};

const calcAtrSeries = (candles: CandleLike[], window = 14) => {
  if (candles.length < 2) return [];
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prevClose = candles[i - 1].close;
    const highLow = candles[i].high - candles[i].low;
    const highClose = Math.abs(candles[i].high - prevClose);
    const lowClose = Math.abs(candles[i].low - prevClose);
    trs.push(Math.max(highLow, highClose, lowClose));
  }
  const atrs: Array<number | null> = Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < trs.length; i += 1) {
    sum += trs[i];
    if (i >= window) {
      sum -= trs[i - window];
    }
    if (i >= window - 1) {
      atrs[i + 1] = sum / window;
    }
  }
  return atrs;
};

const calcAverage = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const mapSeries = (series?: FundamentalPointLike[]) => ({
  values: series?.map((point) => point.value) ?? [],
  dates: series?.map((point) => point.date) ?? [],
});

export const buildSummaryInputFromSnapshot = ({
  symbol,
  technicalData,
  fundamentals,
  optionalityMetrics,
  asOf,
}: BuildSummaryInputParams): SummaryInput | null => {
  const normalizedSymbol = symbol?.trim().toUpperCase();
  if (!normalizedSymbol || !technicalData) return null;

  const candles: CandleLike[] = (technicalData.candles || []).map((c) => ({
    close: Number(c.close),
    high: Number(c.high),
    low: Number(c.low),
    volume: Number(c.volume ?? 0),
  }));
  if (!candles.length) return null;

  const closes = candles.map((c: CandleLike) => c.close).filter((v: number) => Number.isFinite(v));
  const ma50Series = calcSmaSeries(closes, 50);
  const ma200Series = calcSmaSeries(closes, 200);
  const ma50Slope = calcSlopeFromSeries(ma50Series);
  const ma200Slope = calcSlopeFromSeries(ma200Series);

  const rsiSeries = technicalData?.rsi?.series || [];
  const rsiSlope = calcSlopeFromSeries(rsiSeries);
  const macdHistSeries = technicalData?.macd?.histogram_series || [];
  const macdHistSlope = calcSlopeFromSeries(macdHistSeries);

  const atrSeries = calcAtrSeries(candles);
  const atrPctSeries = atrSeries.map((atr, idx) =>
    Number.isFinite(atr) && candles[idx] ? (atr as number) / candles[idx].close * 100 : null
  );
  const atrPctSlope = calcSlopeFromSeries(atrPctSeries);
  const atr14Pct =
    atrPctSeries.filter((value): value is number => Number.isFinite(value)).slice(-1)[0] ?? null;

  const volumes = candles
    .map((c: CandleLike) => c.volume)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  const currentVolume = volumes[volumes.length - 1];
  const avg20 = calcAverage(volumes.slice(-20));
  const volVs20 =
    Number.isFinite(currentVolume) && Number.isFinite(avg20) && avg20
      ? currentVolume / avg20
      : null;

  const recent20 = candles.slice(-20);
  const recent60 = candles.slice(-60);
  const support1 = recent20.length ? Math.min(...recent20.map((c: CandleLike) => c.low)) : null;
  const resistance1 = recent20.length ? Math.max(...recent20.map((c: CandleLike) => c.high)) : null;
  const support2 = recent60.length ? Math.min(...recent60.map((c: CandleLike) => c.low)) : null;
  const resistance2 = recent60.length ? Math.max(...recent60.map((c: CandleLike) => c.high)) : null;

  const eps = mapSeries(fundamentals?.eps?.series);
  const roe = mapSeries(fundamentals?.roe?.series);
  const fcf = mapSeries(fundamentals?.free_cash_flow?.series);
  const mcap = mapSeries(fundamentals?.market_cap?.series);
  const pe = mapSeries(fundamentals?.pe_ratio?.series);
  const revenueYoY = mapSeries(fundamentals?.revenue_yoy?.series);

  return {
    symbol: normalizedSymbol,
    asOf: asOf || new Date().toISOString(),
    technicals: {
      price: technicalData?.current_price ?? null,
      ma50: technicalData?.sma_50 ?? null,
      ma200: technicalData?.sma_200 ?? null,
      ma50_slope: ma50Slope,
      ma200_slope: ma200Slope,
      rsi14: technicalData?.rsi?.current ?? null,
      rsi14_slope: rsiSlope,
      macd: technicalData?.macd?.current ?? null,
      macd_signal: technicalData?.macd?.signal ?? null,
      macd_hist: technicalData?.macd?.histogram ?? null,
      macd_hist_slope: macdHistSlope,
      atr14_pct: atr14Pct,
      atr14_pct_slope: atrPctSlope,
      vol_vs_20d: volVs20,
      support1,
      support2,
      resistance1,
      resistance2,
    },
    fundamentals: {
      eps_series: eps.values,
      eps_dates: eps.dates,
      roe_series: roe.values,
      roe_dates: roe.dates,
      fcf_series: fcf.values,
      fcf_dates: fcf.dates,
      marketcap_series: mcap.values,
      marketcap_dates: mcap.dates,
      pe_series: pe.values,
      pe_dates: pe.dates,
      revenue_yoy_series: revenueYoY.values,
      revenue_yoy_dates: revenueYoY.dates,
    },
    options: {
      iv30: optionalityMetrics?.iv30 ?? null,
      hv30: optionalityMetrics?.hv30 ?? null,
      iv_percentile: optionalityMetrics?.iv_percentile ?? null,
      avg_edr: optionalityMetrics?.avg_edr ?? null,
    },
  };
};
