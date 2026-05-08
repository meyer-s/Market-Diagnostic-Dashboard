export type MetricFamily =
  | "system"
  | "market"
  | "equity"
  | "volatility"
  | "rates"
  | "liquidity"
  | "growth"
  | "sentiment"
  | "credit"
  | "inflation"
  | "energy"
  | "financials"
  | "tech"
  | "consumer"
  | "industrials"
  | "materials"
  | "utilities"
  | "healthcare"
  | "realestate"
  | "communications"
  | "crypto"
  | "metals"
  | "gold"
  | "silver"
  | "platinum"
  | "palladium"
  | "copper"
  | "aluminum"
  | "benchmark"
  | "neutral";

export const familyPalette: Record<
  MetricFamily,
  { base: string; muted: string; faint: string }
> = {
  system: { base: "#60a5fa", muted: "#93c5fd", faint: "#dbeafeb8" },
  market: { base: "#38bdf8", muted: "#7dd3fc", faint: "#e0f2feb8" },
  equity: { base: "#6366f1", muted: "#a5b4fc", faint: "#e0e7ffbc" },
  volatility: { base: "#a78bfa", muted: "#c4b5fd", faint: "#ede9fec7" },
  rates: { base: "#f97316", muted: "#fdba74", faint: "#ffedd5ba" },
  liquidity: { base: "#22d3ee", muted: "#67e8f9", faint: "#cffafeb9" },
  growth: { base: "#14b8a6", muted: "#5eead4", faint: "#ccfbf1b5" },
  sentiment: { base: "#f472b6", muted: "#f9a8d4", faint: "#fce7f3b5" },
  credit: { base: "#fb7185", muted: "#fda4af", faint: "#ffe4e6b4" },
  inflation: { base: "#f59e0b", muted: "#fcd34d", faint: "#fef3c7b9" },
  energy: { base: "#fb923c", muted: "#fdba74", faint: "#ffedd5b5" },
  financials: { base: "#0ea5e9", muted: "#7dd3fc", faint: "#e0f2feb7" },
  tech: { base: "#8b5cf6", muted: "#c4b5fd", faint: "#ede9fecb" },
  consumer: { base: "#ec4899", muted: "#f9a8d4", faint: "#fce7f3b3" },
  industrials: { base: "#94a3b8", muted: "#cbd5f5", faint: "#f1f5f9c0" },
  materials: { base: "#d97706", muted: "#fbbf24", faint: "#fef3c7b0" },
  utilities: { base: "#2dd4bf", muted: "#5eead4", faint: "#ccfbf1be" },
  healthcare: { base: "#38bdf8", muted: "#7dd3fc", faint: "#e0f2febb" },
  realestate: { base: "#a855f7", muted: "#d8b4fe", faint: "#f3e8ffb5" },
  communications: { base: "#e879f9", muted: "#f5d0fe", faint: "#fae8ffc8" },
  crypto: { base: "#60A5FA", muted: "#93C5FD", faint: "#dbeafeb4" },
  metals: { base: "#FBBF24", muted: "#FCD34D", faint: "#fef3c7c7" },
  gold: { base: "#fbbf24", muted: "#fde68a", faint: "#fef9c3c2" },
  silver: { base: "#94a3b8", muted: "#cbd5f5", faint: "#f1f5f9ce" },
  platinum: { base: "#a855f7", muted: "#d8b4fe", faint: "#f3e8ffc0" },
  palladium: { base: "#f87171", muted: "#fca5a5", faint: "#fee2e2b7" },
  copper: { base: "#ea580c", muted: "#fb923c", faint: "#ffedd5b5" },
  aluminum: { base: "#6b7280", muted: "#9ca3af", faint: "#d1d5db95" },
  benchmark: { base: "#6b7280", muted: "#9ca3af", faint: "#d1d5db95" },
  neutral: { base: "#6b7280", muted: "#9ca3af", faint: "#d1d5dba0" },
};

export const statePalette = {
  green: "#10b981",
  yellow: "#eab308",
  red: "#ef4444",
  neutral: "#6b7280",
} as const;

export const metricFamilyByKey: Record<string, MetricFamily> = {
  VIX: "volatility",
  SPY: "equity",
  BREADTH_HEALTH: "equity",
  DFF: "rates",
  T10Y2Y: "rates",
  UNRATE: "growth",
  CONSUMER_HEALTH: "growth",
  BOND_MARKET_STABILITY: "credit",
  LIQUIDITY_PROXY: "liquidity",
  ANALYST_ANXIETY: "sentiment",
  ANALYST_CONFIDENCE: "sentiment",
  SENTIMENT_COMPOSITE: "sentiment",
  XLU: "utilities",
  XLP: "consumer",
  XLV: "healthcare",
  XLE: "energy",
  XLF: "financials",
  XLK: "tech",
  XLY: "consumer",
  XLB: "materials",
  XLI: "industrials",
  XLC: "communications",
  XLRE: "realestate",
  AU: "gold",
  AG: "silver",
  PT: "platinum",
  PD: "palladium",
  CU: "copper",
  AL: "aluminum",
  PCE: "growth",
  PI: "growth",
  CPI: "inflation",
  M2: "liquidity",
  RRP: "liquidity",
  credit_spread_stress: "credit",
  yield_curve_stress: "rates",
  rates_momentum_stress: "rates",
  treasury_volatility_stress: "volatility",
};

export const metricFamilyLabels: Record<MetricFamily, string> = {
  system: "System",
  market: "Market",
  equity: "Equity",
  volatility: "Volatility",
  rates: "Rates",
  liquidity: "Liquidity",
  growth: "Growth",
  sentiment: "Sentiment",
  credit: "Credit",
  inflation: "Inflation",
  energy: "Energy",
  financials: "Financials",
  tech: "Technology",
  consumer: "Consumer",
  industrials: "Industrials",
  materials: "Materials",
  utilities: "Utilities",
  healthcare: "Healthcare",
  realestate: "Real Estate",
  communications: "Communication",
  crypto: "Crypto",
  metals: "Metals",
  gold: "Gold",
  silver: "Silver",
  platinum: "Platinum",
  palladium: "Palladium",
  copper: "Copper",
  aluminum: "Aluminum",
  benchmark: "Benchmark",
  neutral: "Neutral",
};

export const THEME_VIBRANCE_FACTOR = 1.03;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toHex = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");

const parseHexColor = (color: string): { r: number; g: number; b: number; a: string } | null => {
  if (!color.startsWith("#")) return null;
  const hex = color.slice(1);
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: "",
    };
  }
  if (hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.slice(6, 8),
    };
  }
  return null;
};

const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;

  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    default:
      h = (rn - gn) / d + 4;
      break;
  }

  h /= 6;
  return { h, s, l };
};

const hslToRgb = (h: number, s: number, l: number): { r: number; g: number; b: number } => {
  if (s === 0) {
    const gray = l * 255;
    return { r: gray, g: gray, b: gray };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let temp = t;
    if (temp < 0) temp += 1;
    if (temp > 1) temp -= 1;
    if (temp < 1 / 6) return p + (q - p) * 6 * temp;
    if (temp < 1 / 2) return q;
    if (temp < 2 / 3) return p + (q - p) * (2 / 3 - temp) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
};

export const applyThemeVibrance = (color: string, factor: number = THEME_VIBRANCE_FACTOR): string => {
  const parsed = parseHexColor(color);
  if (!parsed) return color;

  const { h, s, l } = rgbToHsl(parsed.r, parsed.g, parsed.b);
  const boosted = hslToRgb(h, clamp(s * factor, 0, 1), l);
  return `#${toHex(boosted.r)}${toHex(boosted.g)}${toHex(boosted.b)}${parsed.a}`;
};

export const getFamilyColor = (
  family: MetricFamily,
  variant: "base" | "muted" | "faint" = "base"
) => applyThemeVibrance(familyPalette[family]?.[variant] ?? familyPalette.system.base);

export const getMetricColor = (
  key: string,
  variant: "base" | "muted" | "faint" = "base"
) => getFamilyColor(metricFamilyByKey[key] ?? "system", variant);
