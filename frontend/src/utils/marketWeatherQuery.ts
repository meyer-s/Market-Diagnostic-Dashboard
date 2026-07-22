import type {
  MarketWeatherLanguageView,
  MarketWeatherMode,
  MarketWeatherTimeframe,
  MarketWeatherTimelineLens,
} from "../types/marketWeather";
import { INSPECTOR_CHANNELS } from "./marketWeather";
import type { MarketTimelineWindow } from "./marketWeatherTimeline";

export interface MarketWeatherRecipeConfig {
  symbol: string;
  timeframe: MarketWeatherTimeframe;
  bars: number;
  horizonMin: number;
  horizonMax: number;
  horizonStep: number;
  stateSmoothing: number;
  crossHorizonBlend: number;
  rendererTimeBlur: number;
  rendererSpatialBlend: number;
  edgeGain: number;
  reflectivityCompression: number;
  contourBands: number;
}

export interface MarketWeatherQueryState {
  config: MarketWeatherRecipeConfig;
  mode: MarketWeatherMode;
  channel: string;
  view: MarketWeatherLanguageView;
  timelineLens: MarketWeatherTimelineLens;
  timelineWindow: MarketTimelineWindow;
}

export const DEFAULT_MARKET_WEATHER_CONFIG: MarketWeatherRecipeConfig = {
  symbol: "SPY",
  timeframe: "1D",
  bars: 750,
  horizonMin: 8,
  horizonMax: 64,
  horizonStep: 1,
  stateSmoothing: 5,
  crossHorizonBlend: 0.32,
  rendererTimeBlur: 3,
  rendererSpatialBlend: 0.42,
  edgeGain: 1.35,
  reflectivityCompression: 4,
  contourBands: 7,
};

export const DEFAULT_MARKET_WEATHER_QUERY_STATE: MarketWeatherQueryState = {
  config: DEFAULT_MARKET_WEATHER_CONFIG,
  mode: "regime",
  channel: "pressure",
  view: "now",
  timelineLens: "direction",
  timelineWindow: 120,
};

const SYMBOL_PATTERN = /^[A-Z0-9.^=/\-]{1,20}$/;
const TIMEFRAME_ALIASES: Record<string, MarketWeatherTimeframe> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "60m": "1h",
  "2h": "2h",
  "4h": "4h",
  "1d": "1D",
  "1w": "1W",
  "1wk": "1W",
};
const MODES = new Set<MarketWeatherMode>(["regime", "convection", "topographic", "swami", "inspector"]);
const VIEWS = new Set<MarketWeatherLanguageView>(["now", "dictionary", "methods"]);
const TIMELINE_LENSES = new Set<MarketWeatherTimelineLens>(["direction", "structure", "carriers", "range", "context"]);
const TIMELINE_WINDOWS = new Set(["60", "120", "250", "all"]);
const CHANNELS = new Set<string>(INSPECTOR_CHANNELS);

function asParams(source: URLSearchParams | string): URLSearchParams {
  if (typeof source !== "string") return source;
  return new URLSearchParams(source.startsWith("?") ? source.slice(1) : source);
}

function boundedNumber(params: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function boundedInteger(params: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  return Math.round(boundedNumber(params, key, fallback, min, max));
}

function normalizeHorizonGrid(config: MarketWeatherRecipeConfig): MarketWeatherRecipeConfig {
  let horizonMin = config.horizonMin;
  let horizonMax = config.horizonMax;
  let horizonStep = config.horizonStep;
  if (horizonMax <= horizonMin) {
    horizonMin = DEFAULT_MARKET_WEATHER_CONFIG.horizonMin;
    horizonMax = DEFAULT_MARKET_WEATHER_CONFIG.horizonMax;
    horizonStep = DEFAULT_MARKET_WEATHER_CONFIG.horizonStep;
  }

  const maximumRows = Math.max(2, Math.min(120, Math.floor(120_000 / config.bars)));
  const minimumStep = Math.ceil((horizonMax - horizonMin) / Math.max(1, maximumRows - 1));
  horizonStep = Math.min(12, Math.max(horizonStep, minimumStep));
  return { ...config, horizonMin, horizonMax, horizonStep };
}

export function parseMarketWeatherQuery(source: URLSearchParams | string): MarketWeatherQueryState {
  const params = asParams(source);
  const defaults = DEFAULT_MARKET_WEATHER_QUERY_STATE;
  const rawSymbol = (params.get("symbol") ?? defaults.config.symbol).trim().toUpperCase();
  const timeframe = TIMEFRAME_ALIASES[(params.get("timeframe") ?? defaults.config.timeframe).trim().toLowerCase()]
    ?? defaults.config.timeframe;
  const modeCandidate = (params.get("mode") ?? defaults.mode) as MarketWeatherMode;
  const viewCandidate = (params.get("view") ?? defaults.view) as MarketWeatherLanguageView;
  const lensCandidate = (params.get("timeline_lens") ?? defaults.timelineLens) as MarketWeatherTimelineLens;
  const windowCandidate = params.get("timeline_window") ?? String(defaults.timelineWindow);
  const channelCandidate = params.get("channel") ?? defaults.channel;

  const config = normalizeHorizonGrid({
    symbol: SYMBOL_PATTERN.test(rawSymbol) ? rawSymbol : defaults.config.symbol,
    timeframe,
    bars: boundedInteger(params, "bars", defaults.config.bars, 60, 5000),
    horizonMin: boundedInteger(params, "horizon_min", defaults.config.horizonMin, 4, 100),
    horizonMax: boundedInteger(params, "horizon_max", defaults.config.horizonMax, 8, 120),
    horizonStep: boundedInteger(params, "horizon_step", defaults.config.horizonStep, 1, 12),
    stateSmoothing: boundedInteger(params, "state_smoothing", defaults.config.stateSmoothing, 1, 20),
    crossHorizonBlend: boundedNumber(params, "cross_horizon_blend", defaults.config.crossHorizonBlend, 0, 1),
    rendererTimeBlur: boundedInteger(params, "renderer_time_blur", defaults.config.rendererTimeBlur, 1, 20),
    rendererSpatialBlend: boundedNumber(params, "renderer_spatial_blend", defaults.config.rendererSpatialBlend, 0, 1),
    edgeGain: boundedNumber(params, "edge_gain", defaults.config.edgeGain, 0.25, 4),
    reflectivityCompression: boundedNumber(params, "reflectivity_compression", defaults.config.reflectivityCompression, 0.25, 12),
    contourBands: boundedInteger(params, "contour_bands", defaults.config.contourBands, 3, 16),
  });

  const timelineWindow: MarketTimelineWindow = TIMELINE_WINDOWS.has(windowCandidate)
    ? windowCandidate === "all" ? "all" : Number(windowCandidate) as 60 | 120 | 250
    : defaults.timelineWindow;

  return {
    config,
    mode: MODES.has(modeCandidate) ? modeCandidate : defaults.mode,
    channel: CHANNELS.has(channelCandidate) ? channelCandidate : defaults.channel,
    view: VIEWS.has(viewCandidate) ? viewCandidate : defaults.view,
    timelineLens: TIMELINE_LENSES.has(lensCandidate) ? lensCandidate : defaults.timelineLens,
    timelineWindow,
  };
}

export function marketWeatherAnalysisParams(config: MarketWeatherRecipeConfig): URLSearchParams {
  return new URLSearchParams({
    symbol: config.symbol,
    timeframe: config.timeframe,
    bars: String(config.bars),
    horizon_min: String(config.horizonMin),
    horizon_max: String(config.horizonMax),
    horizon_step: String(config.horizonStep),
    state_smoothing: String(config.stateSmoothing),
    cross_horizon_blend: String(config.crossHorizonBlend),
    renderer_time_blur: String(config.rendererTimeBlur),
    renderer_spatial_blend: String(config.rendererSpatialBlend),
    edge_gain: String(config.edgeGain),
    reflectivity_compression: String(config.reflectivityCompression),
    contour_bands: String(config.contourBands),
  });
}

export function serializeMarketWeatherQuery(state: MarketWeatherQueryState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("v", "1");
  marketWeatherAnalysisParams(state.config).forEach((value, key) => params.set(key, value));
  params.set("mode", state.mode);
  params.set("channel", state.channel);
  params.set("view", state.view);
  params.set("timeline_lens", state.timelineLens);
  params.set("timeline_window", String(state.timelineWindow));
  return params;
}

export function marketWeatherQueryStateKey(state: MarketWeatherQueryState): string {
  return serializeMarketWeatherQuery(state).toString();
}
