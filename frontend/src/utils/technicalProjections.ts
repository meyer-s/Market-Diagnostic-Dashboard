export type ProjectionHistoryPoint = {
  date: string;
  price?: number | null;
};

export type TechnicalProjectionInput<T extends object = object> = T & {
  current_price: number | null;
  history?: ProjectionHistoryPoint[];
};

export type RelativeClassification = "Winner" | "Neutral" | "Loser";

export type TechnicalProjection<T extends object = object> = Omit<T, "history" | "current_price"> & {
  current_price: number;
  quote_price: number | null;
  analysis_as_of: string;
  observation_count: number;
  rsi_method: "wilder_14";
  annualization_days: 365;
  score_total: number;
  score_trend: number;
  score_momentum: number;
  classification: string;
  relativeClassification: RelativeClassification;
  rank: number;
  technicals: {
    sma_20: number | null;
    sma_50: number | null;
    sma_200: number | null;
    rsi: number | null;
    momentum_5d: number | null;
    momentum_20d: number | null;
    momentum_60d: number | null;
    volatility_30d: number | null;
  };
  levels: {
    support: number[];
    resistance: number[];
    take_profit: number;
    stop_loss: number;
  };
};

const average = (values: number[]) => {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const standardDeviation = (values: number[]) => {
  if (values.length < 2) {
    return null;
  }

  const mean = average(values);
  if (mean === null) {
    return null;
  }

  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
};

const computeSma = (prices: number[], window: number) => {
  if (prices.length < window) {
    return null;
  }
  return average(prices.slice(-window));
};

const computeMomentum = (prices: number[], periods: number) => {
  if (prices.length <= periods) {
    return null;
  }

  const current = prices[prices.length - 1];
  const prior = prices[prices.length - 1 - periods];
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) {
    return null;
  }

  return ((current - prior) / prior) * 100;
};

const computeRsi = (prices: number[], window = 14) => {
  if (prices.length <= window) {
    return null;
  }

  const deltas = prices.slice(1).map((price, index) => price - prices[index]);
  const gains = deltas.map((delta) => (delta > 0 ? delta : 0));
  const losses = deltas.map((delta) => (delta < 0 ? Math.abs(delta) : 0));
  let avgGain = average(gains.slice(0, window)) ?? 0;
  let avgLoss = average(losses.slice(0, window)) ?? 0;
  for (let index = window; index < deltas.length; index += 1) {
    avgGain = (avgGain * (window - 1) + gains[index]) / window;
    avgLoss = (avgLoss * (window - 1) + losses[index]) / window;
  }

  if (avgLoss === 0 && avgGain === 0) {
    return 50;
  }
  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
};

const computeVolatility = (prices: number[], window = 30) => {
  if (prices.length <= window) {
    return null;
  }

  const sample = prices.slice(-window - 1);
  const returns = sample.slice(1).map((price, index) => {
    const prior = sample[index];
    return prior ? (price - prior) / prior : 0;
  });

  const stdev = standardDeviation(returns);
  return stdev === null ? null : stdev * Math.sqrt(365) * 100;
};

const detectPriceLevels = (prices: number[], currentPrice: number, window = 5) => {
  const supportLevels: number[] = [];
  const resistanceLevels: number[] = [];

  for (let index = window; index < prices.length - window; index += 1) {
    const current = prices[index];
    const neighborhood = prices.slice(index - window, index + window + 1);
    if (current === Math.min(...neighborhood)) {
      supportLevels.push(current);
    }
    if (current === Math.max(...neighborhood)) {
      resistanceLevels.push(current);
    }
  }

  return {
    support: Array.from(new Set(supportLevels.filter((level) => level < currentPrice))).sort((left, right) => left - right).slice(-3),
    resistance: Array.from(new Set(resistanceLevels.filter((level) => level > currentPrice))).sort((left, right) => left - right).slice(0, 3),
  };
};

const getClassificationLabel = (scoreTotal: number) => {
  if (scoreTotal >= 75) return "Strong";
  if (scoreTotal >= 60) return "Bullish";
  if (scoreTotal >= 40) return "Neutral";
  if (scoreTotal >= 25) return "Bearish";
  return "Weak";
};

/** Crypto-only daily technical model; inputs are normalized to UTC calendar days. */
export function buildTechnicalProjections<T extends object>(assets: Array<TechnicalProjectionInput<T>>): Array<TechnicalProjection<T>> {
  const projections = assets.flatMap((asset) => {
    const today = new Date().toISOString().slice(0, 10);
    const sessions = new Map<string, { timestamp: number; price: number }>();
    for (const point of asset.history ?? []) {
      if (typeof point.price !== "number" || !Number.isFinite(point.price) || point.price <= 0) continue;
      const datePart = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(point.date);
      const timestamp = Date.parse(point.date);
      if (!datePart || !Number.isFinite(timestamp)) continue;
      // Date.parse normalizes invalid dates such as February 31; reject them.
      const calendarDate = new Date(Date.UTC(Number(datePart[1]), Number(datePart[2]) - 1, Number(datePart[3]))).toISOString().slice(0, 10);
      if (calendarDate !== point.date.slice(0, 10)) continue;
      const day = new Date(timestamp).toISOString().slice(0, 10);
      if (day > today) continue;
      const previous = sessions.get(day);
      if (!previous || timestamp >= previous.timestamp) sessions.set(day, { timestamp, price: point.price });
    }
    const orderedHistory = [...sessions.entries()].sort(([left], [right]) => left.localeCompare(right));
    // Crypto trades every UTC day. Do not turn a missing day into a one-day
    // return or give duplicate observations extra moving-average weight.
    let start = orderedHistory.length - 1;
    while (start > 0 && Date.parse(orderedHistory[start][0]) - Date.parse(orderedHistory[start - 1][0]) === 86_400_000) start -= 1;
    const dailyHistory = orderedHistory.slice(Math.max(start, 0));
    if (dailyHistory.length < 200) {
      return [];
    }
    const prices = dailyHistory.map(([, point]) => point.price);
    const currentPrice = prices[prices.length - 1];
    const quotePrice = typeof asset.current_price === "number" && Number.isFinite(asset.current_price) && asset.current_price > 0 ? asset.current_price : null;

    const sma20 = computeSma(prices, 20);
    const sma50 = computeSma(prices, 50);
    const sma200 = computeSma(prices, 200);
    const rsi = computeRsi(prices, 14);
    const momentum5d = computeMomentum(prices, 5);
    const momentum20d = computeMomentum(prices, 20);
    const momentum60d = computeMomentum(prices, 60);
    const volatility30d = computeVolatility(prices, 30);

    const sma20Distance = sma20 ? ((currentPrice - sma20) / sma20) * 100 : 0;
    const sma50Distance = sma50 ? ((currentPrice - sma50) / sma50) * 100 : 0;
    const sma200Distance = sma200 ? ((currentPrice - sma200) / sma200) * 100 : 0;

    // Continuous SMA trend score: peaks at moderate outperformance, penalises over-extension and below-SMA
    const smaTrendScore = (distance: number, peakPct: number): number => {
      if (distance <= 0) return Math.max(0, 5 + distance * 0.3);
      if (distance <= peakPct) return 5 + (distance / peakPct) * 20;
      return Math.max(5, 25 - (distance - peakPct) * 0.8);
    };

    let scoreTrend = 0;
    if (sma20 !== null && sma50 !== null) {
      scoreTrend += smaTrendScore(sma20Distance, 8);
      scoreTrend += smaTrendScore(sma50Distance, 12);
      scoreTrend += sma200 !== null ? smaTrendScore(sma200Distance, 20) : 5;
      // Alignment: continuous spread between SMA20 and SMA50
      const spread = ((sma20 - sma50) / sma50) * 100;
      scoreTrend += spread >= 0 ? Math.min(25, 15 + spread) : Math.max(5, 15 + spread);
    }

    // Continuous RSI momentum: peaks at RSI=50 (neutral/healthy), decays symmetrically toward extremes
    let scoreMomentum = 0;
    if (rsi !== null) {
      scoreMomentum = Math.max(0, 100 - Math.abs(rsi - 50) * 3);
    }

    const levels = detectPriceLevels(prices.slice(-90), currentPrice);
    const scoreTotal = Number(((scoreTrend * 0.6) + (scoreMomentum * 0.4)).toFixed(1));
    if ([sma20, sma50, sma200, rsi, momentum5d, momentum20d, momentum60d, volatility30d,
      scoreTrend, scoreMomentum, scoreTotal, currentPrice * 1.1, currentPrice * 0.95].some((value) => !Number.isFinite(value))) return [];
    const { history, ...rest } = asset;

    return [{
      ...rest,
      current_price: currentPrice,
      quote_price: quotePrice,
      analysis_as_of: dailyHistory[dailyHistory.length - 1][0],
      observation_count: dailyHistory.length,
      rsi_method: "wilder_14",
      annualization_days: 365,
      score_total: scoreTotal,
      score_trend: scoreTrend,
      score_momentum: scoreMomentum,
      classification: getClassificationLabel(scoreTotal),
      relativeClassification: "Neutral" as RelativeClassification,
      rank: 0,
      technicals: {
        sma_20: sma20,
        sma_50: sma50,
        sma_200: sma200,
        rsi,
        momentum_5d: momentum5d,
        momentum_20d: momentum20d,
        momentum_60d: momentum60d,
        volatility_30d: volatility30d,
      },
      levels: {
        support: levels.support,
        resistance: levels.resistance,
        take_profit: Number((currentPrice * 1.1).toFixed(2)),
        stop_loss: Number((currentPrice * 0.95).toFixed(2)),
      },
    } as TechnicalProjection<T>];
  });

  return projections
    .sort((left, right) => right.score_total - left.score_total)
    .map((projection, _index, ranked) => ({
      ...projection,
      rank: ranked.findIndex((item) => item.score_total === projection.score_total) + 1,
      relativeClassification: ranked[0].score_total === ranked[ranked.length - 1].score_total
        ? "Neutral"
        : projection.score_total === ranked[0].score_total
          ? "Winner"
          : projection.score_total === ranked[ranked.length - 1].score_total ? "Loser" : "Neutral",
    }) as TechnicalProjection<T>);
}
