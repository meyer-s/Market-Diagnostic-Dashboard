export type ProjectionHistoryPoint = {
  date: string;
  price: number | null | undefined;
};

export type TechnicalProjectionInput<T extends object = object> = T & {
  current_price: number | null;
  history: ProjectionHistoryPoint[];
};

export type RelativeClassification = "Winner" | "Neutral" | "Loser";

export type TechnicalProjection<T extends object = object> = Omit<T, "history" | "current_price"> & {
  current_price: number;
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
  if (!values.length) {
    return null;
  }

  const mean = average(values);
  if (mean === null) {
    return null;
  }

  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
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

  const sample = prices.slice(-window - 1);
  const deltas = sample.slice(1).map((price, index) => price - sample[index]);
  const gains = deltas.map((delta) => (delta > 0 ? delta : 0));
  const losses = deltas.map((delta) => (delta < 0 ? Math.abs(delta) : 0));
  const avgGain = average(gains) ?? 0;
  const avgLoss = average(losses) ?? 0;

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
  return stdev === null ? null : stdev * Math.sqrt(252) * 100;
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

export function buildTechnicalProjections<T extends object>(assets: Array<TechnicalProjectionInput<T>>): Array<TechnicalProjection<T>> {
  const projections = assets.flatMap((asset) => {
    const orderedHistory = [...asset.history]
      .filter((point) => point.price !== null && point.price !== undefined && Number.isFinite(point.price))
      .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
    const prices = orderedHistory.map((point) => point.price as number);
    const currentPrice = asset.current_price ?? prices[prices.length - 1];

    if (!prices.length || currentPrice === null || currentPrice === undefined || !Number.isFinite(currentPrice)) {
      return [];
    }

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

    let scoreTrend = 0;
    if (sma20 !== null && sma50 !== null) {
      scoreTrend += currentPrice > sma20 ? (sma20Distance > 10 ? 10 : sma20Distance > 5 ? 20 : 25) : 5;
      scoreTrend += currentPrice > sma50 ? (sma50Distance > 15 ? 10 : sma50Distance > 8 ? 20 : 25) : 5;
      scoreTrend += sma200 !== null && currentPrice > sma200 ? (sma200Distance > 25 ? 10 : sma200Distance > 15 ? 20 : 25) : 5;
      scoreTrend += sma20 > sma50 ? 25 : 10;
    }

    let scoreMomentum = 0;
    if (rsi !== null) {
      if (rsi >= 45 && rsi <= 55) scoreMomentum = 100;
      else if ((rsi >= 40 && rsi < 45) || (rsi > 55 && rsi <= 60)) scoreMomentum = 90;
      else if ((rsi >= 35 && rsi < 40) || (rsi > 60 && rsi <= 65)) scoreMomentum = 75;
      else if ((rsi >= 30 && rsi < 35) || (rsi > 65 && rsi <= 70)) scoreMomentum = 50;
      else if (rsi < 30) scoreMomentum = 30;
      else if (rsi > 70) scoreMomentum = 25;
    }

    const levels = detectPriceLevels(prices.slice(-90), currentPrice);
    const scoreTotal = (scoreTrend * 0.6) + (scoreMomentum * 0.4);
    const { history, ...rest } = asset;

    return [{
      ...rest,
      current_price: currentPrice,
      score_total: Number(scoreTotal.toFixed(1)),
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
    .map((projection, index, ranked) => ({
      ...projection,
      rank: index + 1,
      relativeClassification: index === 0 ? "Winner" : index === ranked.length - 1 ? "Loser" : "Neutral",
    }) as TechnicalProjection<T>);
}