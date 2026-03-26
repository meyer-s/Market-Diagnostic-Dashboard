import type {
  AxisBias,
  AxisScore,
  HolisticSummary,
  OptBias,
  SummaryInput,
  TechBias,
} from "../types/holisticSummary";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const formatPct = (value: number | null | undefined, digits = 1) =>
  isNumber(value) ? `${value.toFixed(digits)}%` : "n/a";

const formatPrice = (value: number | null | undefined) =>
  isNumber(value) ? `$${value.toFixed(2)}` : "n/a";

const formatPoint = (value: number | null | undefined) =>
  isNumber(value) ? value.toFixed(1) : "n/a";

const percentileRank = (values: number[], value: number): number => {
  if (!values.length) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.filter((v) => v <= value).length;
  return (count / sorted.length) * 100;
};

const linearSlope = (values: number[]): number | null => {
  if (values.length < 3) return null;
  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
};

const seriesStats = (values?: number[]) => {
  const series = (values || []).filter((value) => isNumber(value)) as number[];
  if (!series.length) {
    return {
      latest: null,
      qoq: null,
      yoy: null,
      slope6: null,
      slope3: null,
    };
  }
  const latest = series[series.length - 1];
  const qoq = series.length >= 2 ? ((latest - series[series.length - 2]) / Math.abs(series[series.length - 2] || 1)) * 100 : null;
  const yoy = series.length >= 5 ? ((latest - series[series.length - 5]) / Math.abs(series[series.length - 5] || 1)) * 100 : null;
  const slope6 = linearSlope(series.slice(-6));
  const slope3 = linearSlope(series.slice(-3));
  return { latest, qoq, yoy, slope6, slope3 };
};

const buildTechnicalAxis = (input: SummaryInput["technicals"]): AxisScore => {
  const rules: string[] = [];
  let score = 0;

  const trendUp =
    isNumber(input.price) &&
    isNumber(input.ma50) &&
    isNumber(input.ma50_slope) &&
    input.price > input.ma50 &&
    input.ma50_slope > 0 &&
    ((isNumber(input.ma200) && input.price > input.ma200) ||
      (isNumber(input.ma200_slope) && input.ma200_slope >= 0));

  const trendDown =
    isNumber(input.price) &&
    isNumber(input.ma50) &&
    isNumber(input.ma50_slope) &&
    input.price < input.ma50 &&
    input.ma50_slope < 0 &&
    isNumber(input.ma200) &&
    input.price < input.ma200;

  if (trendUp) {
    score += 40;
    rules.push("trend_up");
  } else if (trendDown) {
    score -= 40;
    rules.push("trend_down");
  } else {
    rules.push("trend_sideways");
  }

  const rsiBull = isNumber(input.rsi14) && input.rsi14 >= 55 && (input.rsi14_slope || 0) > 0;
  const rsiBear = isNumber(input.rsi14) && input.rsi14 <= 45 && (input.rsi14_slope || 0) < 0;
  if (rsiBull) {
    score += 15;
    rules.push("rsi_bullish");
  } else if (rsiBear) {
    score -= 15;
    rules.push("rsi_bearish");
  }

  const macdBull =
    isNumber(input.macd) &&
    isNumber(input.macd_signal) &&
    isNumber(input.macd_hist) &&
    input.macd > input.macd_signal &&
    input.macd_hist > 0;
  const macdBear =
    isNumber(input.macd) &&
    isNumber(input.macd_signal) &&
    isNumber(input.macd_hist) &&
    input.macd < input.macd_signal &&
    input.macd_hist < 0;
  if (macdBull) {
    score += 15;
    rules.push("macd_bullish");
  } else if (macdBear) {
    score -= 15;
    rules.push("macd_bearish");
  }

  if (isNumber(input.macd_hist_slope)) {
    if (macdBull && input.macd_hist_slope > 0) {
      score += 5;
      rules.push("macd_hist_expand");
    } else if (macdBear && input.macd_hist_slope < 0) {
      score -= 5;
      rules.push("macd_hist_expand_down");
    }
  }

  if (isNumber(input.vol_vs_20d)) {
    if (input.vol_vs_20d >= 1.2) {
      score += 15;
      rules.push("volume_confirm");
    } else if (input.vol_vs_20d <= 0.8) {
      score -= 15;
      rules.push("volume_weak");
    }
  }

  let upsideRoom: number | null = null;
  let downsideRoom: number | null = null;
  if (isNumber(input.price) && isNumber(input.resistance1)) {
    upsideRoom = (input.resistance1 - input.price) / input.price * 100;
  }
  if (isNumber(input.price) && isNumber(input.support1)) {
    downsideRoom = (input.price - input.support1) / input.price * 100;
  }
  if (isNumber(upsideRoom) && isNumber(downsideRoom)) {
    if (upsideRoom >= downsideRoom * 1.5) {
      score += 15;
      rules.push("better_upside_room");
    } else if (downsideRoom >= upsideRoom * 1.5) {
      score -= 15;
      rules.push("tight_downside_room");
    }
  }

  const nearSupport = isNumber(downsideRoom) && downsideRoom <= 2;
  const nearResistance = isNumber(upsideRoom) && upsideRoom <= 2;

  const bias: TechBias = score >= 20 ? "BULLISH" : score <= -20 ? "BEARISH" : "NEUTRAL";

  const missingFields = [
    input.price,
    input.ma50,
    input.ma50_slope,
    input.ma200,
    input.rsi14,
    input.macd,
    input.macd_signal,
    input.macd_hist,
    input.vol_vs_20d,
  ].filter((value) => !isNumber(value)).length;
  const confidence = clamp(70 - missingFields * 8, 0, 100);

  const facts: string[] = [];
  if (isNumber(input.price) && isNumber(input.ma50) && isNumber(input.ma50_slope)) {
    facts.push(
      `Price is ${input.price > input.ma50 ? "above" : "below"} the 50D MA and the slope is ${
        input.ma50_slope > 0 ? "rising" : "falling"
      }.`
    );
  }
  if (isNumber(input.rsi14) && isNumber(input.rsi14_slope) && isNumber(input.macd_hist)) {
    facts.push(
      `RSI ${formatPoint(input.rsi14)} ${
        input.rsi14_slope > 0 ? "rising" : "falling"
      }; MACD histogram ${input.macd_hist > 0 ? "positive" : "negative"}.`
    );
  }
  if (isNumber(input.support1) || isNumber(input.resistance1)) {
    facts.push(
      `Nearest support ${formatPrice(input.support1)}; resistance ${formatPrice(input.resistance1)}.`
    );
  }

  const watchouts: string[] = [];
  if (isNumber(input.atr14_pct_slope) && input.atr14_pct_slope > 0) {
    watchouts.push("Volatility expanding.");
  }
  if (nearSupport) {
    watchouts.push("Near support.");
  }
  if (nearResistance) {
    watchouts.push("Near resistance.");
  }

  return {
    label: "Technicals",
    bias,
    score: clamp(score, -100, 100),
    confidence,
    facts,
    watchouts,
    debug: {
      rules,
      trend: trendUp ? "UP" : trendDown ? "DOWN" : "SIDEWAYS",
      upside_room_pct: upsideRoom,
      downside_room_pct: downsideRoom,
      near_support: nearSupport,
      near_resistance: nearResistance,
      vol_expanding: isNumber(input.atr14_pct_slope) && input.atr14_pct_slope > 0,
      support1: input.support1,
      resistance1: input.resistance1,
    },
  };
};

const buildFundamentalAxis = (input: SummaryInput["fundamentals"]): AxisScore => {
  const epsStats = seriesStats(input.eps_series);
  const roeStats = seriesStats(input.roe_series);
  const fcfStats = seriesStats(input.fcf_series);
  const peStats = seriesStats(input.pe_series);
  const mcapStats = seriesStats(input.marketcap_series);
  const revenueStats = seriesStats(input.revenue_yoy_series);

  let score = 0;
  const rules: string[] = [];

  if (isNumber(epsStats.yoy) && isNumber(epsStats.slope6)) {
    if (epsStats.yoy > 0 && epsStats.slope6 > 0) {
      score += 30;
      rules.push("eps_improving");
    } else if (epsStats.yoy < 0 && epsStats.slope6 < 0) {
      score -= 30;
      rules.push("eps_deteriorating");
    }
  }

  if (isNumber(roeStats.latest) && isNumber(roeStats.slope6)) {
    if (roeStats.latest >= 10 && roeStats.slope6 > 0) {
      score += 20;
      rules.push("roe_strong");
    } else if (roeStats.latest <= 5 && roeStats.slope6 < 0) {
      score -= 20;
      rules.push("roe_weak");
    }
  }

  if (isNumber(fcfStats.yoy) && isNumber(fcfStats.slope6)) {
    if (fcfStats.yoy > 0 && fcfStats.slope6 > 0) {
      score += 30;
      rules.push("fcf_improving");
    } else if (fcfStats.yoy < 0 && fcfStats.slope6 < 0) {
      score -= 30;
      rules.push("fcf_deteriorating");
    }
  }

  if (isNumber(peStats.latest) && (input.pe_series || []).length >= 4) {
    const percentile = percentileRank(input.pe_series || [], peStats.latest);
    if (percentile <= 30) {
      score += 20;
      rules.push("pe_cheaper");
    } else if (percentile >= 70) {
      score -= 20;
      rules.push("pe_expensive");
    }
  }

  if (isNumber(mcapStats.latest) && (input.marketcap_series || []).length >= 3) {
    const maxCap = Math.max(...(input.marketcap_series || []));
    if (isNumber(maxCap) && maxCap > 0) {
      const drawdown = (mcapStats.latest - maxCap) / maxCap;
      if (drawdown <= -0.3) {
        score -= 10;
        rules.push("marketcap_drawdown");
      } else if (drawdown >= -0.05) {
        score += 5;
        rules.push("marketcap_near_high");
      }
    }
  }

  const bias: AxisBias = score >= 20 ? "POSITIVE" : score <= -20 ? "NEGATIVE" : "NEUTRAL";

  const missingSeries = [
    input.eps_series,
    input.roe_series,
    input.fcf_series,
    input.pe_series,
  ].filter((series) => !(series && series.length >= 2)).length;
  const longCoverage = Math.max(
    input.eps_series?.length || 0,
    input.roe_series?.length || 0,
    input.fcf_series?.length || 0
  ) >= 12;
  const confidence = clamp(70 - missingSeries * 10 + (longCoverage ? 5 : 0), 0, 100);

  const facts: string[] = [];
  if (isNumber(epsStats.yoy)) {
    facts.push(`EPS trend YoY ${formatPct(epsStats.yoy)} over the last year.`);
  }
  if (isNumber(roeStats.latest) && isNumber(roeStats.slope6)) {
    facts.push(`ROE ${formatPct(roeStats.latest)} and ${roeStats.slope6 > 0 ? "improving" : "softening"}.`);
  }
  if (isNumber(fcfStats.yoy)) {
    facts.push(`FCF YoY ${formatPct(fcfStats.yoy)} with ${fcfStats.slope6 && fcfStats.slope6 > 0 ? "rising" : "flat"} momentum.`);
  } else if (isNumber(revenueStats.latest)) {
    facts.push(`Revenue growth YoY ${formatPct(revenueStats.latest)}.`);
  }

  return {
    label: "Fundamentals",
    bias,
    score: clamp(score, -100, 100),
    confidence,
    facts,
    debug: {
      rules,
      eps: epsStats,
      roe: roeStats,
      fcf: fcfStats,
      pe: peStats,
      marketcap: mcapStats,
      revenue_yoy: revenueStats,
    },
  };
};

const resolveOptionsBias = (input: SummaryInput["options"]): OptBias => {
  if (input.mispricing_state) return input.mispricing_state;

  const votes: OptBias[] = [];
  if (isNumber(input.iv30) && isNumber(input.hv30)) {
    const spread = input.iv30 - input.hv30;
    if (spread > 5) votes.push("EXPENSIVE");
    else if (spread < -5) votes.push("CHEAP");
    else votes.push("FAIR");
  }
  if (isNumber(input.iv_percentile)) {
    if (input.iv_percentile > 70) votes.push("EXPENSIVE");
    else if (input.iv_percentile < 30) votes.push("CHEAP");
    else votes.push("FAIR");
  }
  if (isNumber(input.avg_edr)) {
    if (input.avg_edr > 60) votes.push("EXPENSIVE");
    else if (input.avg_edr < 40) votes.push("CHEAP");
    else votes.push("FAIR");
  }
  if (!votes.length) return "UNKNOWN";
  const tally = votes.reduce<Record<OptBias, number>>(
    (acc, vote) => ({ ...acc, [vote]: (acc[vote] || 0) + 1 }),
    { CHEAP: 0, FAIR: 0, EXPENSIVE: 0, UNKNOWN: 0 }
  );
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] === sorted[1][1]) return "FAIR";
  return sorted[0][0] as OptBias;
};

const buildOptionsAxis = (input: SummaryInput["options"]): AxisScore => {
  const rules: string[] = [];
  const bias = resolveOptionsBias(input);
  const score = bias === "CHEAP" ? 60 : bias === "EXPENSIVE" ? -60 : 0;
  const missing = [input.iv30, input.hv30, input.iv_percentile, input.avg_edr].filter(
    (value) => !isNumber(value)
  ).length;
  const confidence = clamp(70 - missing * 20 - (bias === "UNKNOWN" ? 20 : 0), 0, 100);

  if (isNumber(input.iv30) && isNumber(input.hv30)) {
    rules.push(`iv_spread_${input.iv30 - input.hv30 > 0 ? "positive" : "negative"}`);
  }
  if (isNumber(input.iv_percentile)) {
    rules.push(`iv_percentile_${input.iv_percentile}`);
  }

  const facts: string[] = [];
  if (isNumber(input.iv30) && isNumber(input.hv30)) {
    facts.push(`IV30 ${formatPoint(input.iv30)} vs HV30 ${formatPoint(input.hv30)} (spread ${formatPoint(input.iv30 - input.hv30)}).`);
  }
  if (isNumber(input.iv_percentile) || isNumber(input.avg_edr)) {
    facts.push(
      `IV percentile ${formatPoint(input.iv_percentile)}; expected daily range ${formatPoint(input.avg_edr)}% → options ${bias.toLowerCase()}.`
    );
  }

  return {
    label: "Options Mispricing",
    bias,
    score,
    confidence,
    facts,
    debug: {
      rules,
      iv_spread: isNumber(input.iv30) && isNumber(input.hv30) ? input.iv30 - input.hv30 : null,
    },
  };
};

const resolveRegime = (
  technical: AxisScore,
  fundamental: AxisScore,
  options: AxisScore
) => {
  const rationale: string[] = [];
  const techBias = technical.bias as TechBias;
  const fundBias = fundamental.bias as AxisBias;
  const optBias = options.bias as OptBias;

  if (fundBias === "POSITIVE" && techBias === "BULLISH" && optBias !== "EXPENSIVE") {
    rationale.push("fundamentals positive, tape bullish, options not expensive");
    return { key: "Confirmed Strength", rationale };
  }
  if (techBias === "BULLISH" && optBias === "EXPENSIVE") {
    rationale.push("bullish tape with expensive options");
    return { key: "Speculative / Overheated", rationale };
  }
  if (fundBias === "POSITIVE" && optBias === "CHEAP" && techBias !== "BULLISH") {
    rationale.push("value signals with headwinds on tape");
    return { key: "Value With Headwinds", rationale };
  }
  if (fundBias === "POSITIVE" && techBias !== "BULLISH") {
    rationale.push("fundamentals positive, tape not bullish");
    return { key: "Quality, Waiting on Tape", rationale };
  }
  if (fundBias !== "POSITIVE" && techBias === "BULLISH") {
    rationale.push("tape bullish without fundamental support");
    return { key: "Momentum, Not Fundamental", rationale };
  }
  if (fundBias === "NEGATIVE" && techBias === "BEARISH") {
    rationale.push("fundamentals and tape aligned lower");
    return { key: "Confirmed Weakness", rationale };
  }
  rationale.push("axes disagree");
  return { key: "Mixed / Conflict", rationale };
};

const selectWatchLine = (
  technical: AxisScore,
  fundamental: AxisScore,
  options: AxisScore
) => {
  const debug = technical.debug as Record<string, unknown> | undefined;
  const nearResistance = Boolean(debug?.near_resistance);
  const nearSupport = Boolean(debug?.near_support);
  const volExpanding = Boolean(debug?.vol_expanding);
  const techBull = technical.bias === "BULLISH";
  const fundPos = fundamental.bias === "POSITIVE";
  const optExpensive = options.bias === "EXPENSIVE";

  if (nearResistance && techBull && optExpensive) {
    return "Near resistance + expensive options increases pullback risk.";
  }
  if (nearSupport && fundPos) {
    return "Holding support is key; fundamentals strong but tape still undecided.";
  }
  if (volExpanding) {
    return "Volatility expanding; signals may be less reliable short-term.";
  }

  const support = debug?.support1 as number | undefined;
  const resistance = debug?.resistance1 as number | undefined;
  if (isNumber(support) || isNumber(resistance)) {
    return `Watch ${formatPrice(support)} / ${formatPrice(resistance)} as the next decision point.`;
  }

  return "Watch for the next decisive breakout or breakdown.";
};

export const buildHolisticSummary = (input: SummaryInput): HolisticSummary => {
  const technical = buildTechnicalAxis(input.technicals);
  const fundamental = buildFundamentalAxis(input.fundamentals);
  const options = buildOptionsAxis(input.options);
  const regimeMatrix = resolveRegime(technical, fundamental, options);
  const watch = selectWatchLine(technical, fundamental, options);

  const fundamentalSentence = `Fundamentals read ${fundamental.bias.toLowerCase()}, with key trends ${
    fundamental.score >= 0 ? "holding up" : "softening"
  }.`;
  const technicalSentence = `Technicals are ${technical.bias.toLowerCase()}, with trend and momentum ${
    technical.score >= 0 ? "supportive" : "fragile"
  }.`;
  const optionsSentence = `Options expectations look ${options.bias.toLowerCase()}, suggesting ${
    options.bias === "CHEAP" ? "implied risk is below realized." : options.bias === "EXPENSIVE" ? "pricing looks rich." : "no clear mispricing."
  }`;

  const bullets = [
    {
      axis: technical.label,
      text: technical.facts[0] || "Insufficient technical data for a clean read.",
    },
    {
      axis: fundamental.label,
      text: fundamental.facts[0] || "Fundamental series coverage is limited.",
    },
    {
      axis: options.label,
      text: options.facts[0] || "Options data is incomplete for a clean read.",
    },
  ];

  const narrative = `Regime: ${regimeMatrix.key}. ${fundamentalSentence} ${technicalSentence} ${optionsSentence} Watch: ${watch}`;

  return {
    regime: regimeMatrix.key,
    narrative,
    bullets,
    watch,
    debug: {
      technical,
      fundamental,
      options,
      regime_matrix: regimeMatrix,
    },
  };
};

export const _testHelpers = {
  resolveRegime,
  resolveOptionsBias,
};
