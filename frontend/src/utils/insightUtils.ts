export type TrendSignal = {
  direction: "up" | "down" | "flat";
  strength: "strong" | "moderate" | "weak";
  volatility: "calm" | "choppy";
  momentum: "accelerating" | "fading" | "steady";
};

export type InsightSignal = {
  id: "system" | "dow" | "sector" | "aas";
  label: string;
  direction: "up" | "down" | "flat";
  stance: "risk-on" | "risk-off" | "mixed";
  confidence: "high" | "medium" | "low";
  summary: string;
};

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const stdDev = (values: number[]) => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
};

export const analyzeSeries = (
  values: number[],
  options?: { recent?: number; prior?: number; flatThreshold?: number }
): TrendSignal => {
  const cleaned = values.filter((value) => Number.isFinite(value));
  if (cleaned.length < 4) {
    return {
      direction: "flat",
      strength: "weak",
      volatility: "calm",
      momentum: "steady",
    };
  }

  const recentCount = Math.min(options?.recent ?? 6, cleaned.length);
  const priorCount = Math.min(options?.prior ?? 6, cleaned.length - recentCount);
  const recent = cleaned.slice(-recentCount);
  const prior = priorCount
    ? cleaned.slice(-(recentCount + priorCount), -recentCount)
    : cleaned.slice(0, Math.max(1, cleaned.length - recentCount));

  const minValue = Math.min(...cleaned);
  const maxValue = Math.max(...cleaned);
  const range = Math.max(maxValue - minValue, 1);
  const delta = mean(recent) - mean(prior);
  const deltaRatio = Math.abs(delta) / range;
  const flatThreshold = options?.flatThreshold ?? 0.08;

  const direction =
    deltaRatio < flatThreshold ? "flat" : delta > 0 ? "up" : "down";
  const strength =
    deltaRatio > 0.35 ? "strong" : deltaRatio > 0.2 ? "moderate" : "weak";

  const volatility = stdDev(cleaned) / range > 0.35 ? "choppy" : "calm";

  const shortCount = Math.min(3, cleaned.length);
  const midCount = Math.min(6, cleaned.length);
  const shortDelta = mean(cleaned.slice(-shortCount)) - mean(cleaned.slice(-midCount));
  const momentumThreshold = 0.05 * range;
  let momentum: TrendSignal["momentum"] = "steady";
  if (direction === "up") {
    if (shortDelta > momentumThreshold) momentum = "accelerating";
    else if (shortDelta < -momentumThreshold * 0.6) momentum = "fading";
  } else if (direction === "down") {
    if (shortDelta < -momentumThreshold) momentum = "accelerating";
    else if (shortDelta > momentumThreshold * 0.6) momentum = "fading";
  }

  return { direction, strength, volatility, momentum };
};

export const getTrendTone = (signal: TrendSignal) => {
  if (signal.volatility === "choppy" && signal.strength === "weak") return "noisy";
  if (signal.volatility === "choppy") return "uneven";
  if (signal.strength === "strong") return "clear";
  return "mixed";
};

export const getConfidenceFromSignal = (
  signal: TrendSignal
): InsightSignal["confidence"] => {
  if (signal.volatility === "choppy" && signal.strength !== "strong") return "low";
  if (signal.strength === "strong" && signal.volatility === "calm") return "high";
  return "medium";
};
