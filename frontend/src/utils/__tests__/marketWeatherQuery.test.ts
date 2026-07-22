import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARKET_WEATHER_QUERY_STATE,
  marketWeatherAnalysisParams,
  parseMarketWeatherQuery,
  serializeMarketWeatherQuery,
} from "../marketWeatherQuery";

describe("market weather report query", () => {
  it("uses the stable report defaults when the query is empty", () => {
    expect(parseMarketWeatherQuery("")).toEqual(DEFAULT_MARKET_WEATHER_QUERY_STATE);
  });

  it("round-trips every analysis and presentation selector", () => {
    const state = parseMarketWeatherQuery(
      "?symbol=iwm&timeframe=15m&bars=913&horizon_min=6&horizon_max=80&horizon_step=2&state_smoothing=8&cross_horizon_blend=.45&renderer_time_blur=4&renderer_spatial_blend=.55&edge_gain=1.8&reflectivity_compression=5.5&contour_bands=9&mode=inspector&channel=jerk&view=dictionary&timeline_lens=context&timeline_window=250",
    );

    expect(parseMarketWeatherQuery(serializeMarketWeatherQuery(state))).toEqual(state);
    expect(state.config.symbol).toBe("IWM");
    expect(state.config.bars).toBe(913);
    expect(state.view).toBe("dictionary");
  });

  it("accepts documented timeframe aliases and repairs unsupported selectors", () => {
    const parsed = parseMarketWeatherQuery("?timeframe=1wk&mode=rainbow&channel=nope&view=elsewhere&timeline_lens=nope&timeline_window=999");
    expect(parsed.config.timeframe).toBe("1W");
    expect(parsed.mode).toBe("regime");
    expect(parsed.channel).toBe("pressure");
    expect(parsed.view).toBe("now");
    expect(parsed.timelineLens).toBe("direction");
    expect(parsed.timelineWindow).toBe(120);
  });

  it("clamps numeric inputs and repairs an inverted horizon range", () => {
    const parsed = parseMarketWeatherQuery("?symbol=not%20valid&bars=99999&horizon_min=90&horizon_max=20&state_smoothing=NaN&edge_gain=-2&contour_bands=100");
    expect(parsed.config.symbol).toBe("SPY");
    expect(parsed.config.bars).toBe(5000);
    expect(parsed.config.horizonMin).toBe(8);
    expect(parsed.config.horizonMax).toBe(64);
    expect(parsed.config.stateSmoothing).toBe(5);
    expect(parsed.config.edgeGain).toBe(0.25);
    expect(parsed.config.contourBands).toBe(16);
  });

  it("raises the step deterministically to stay within the field-cell budget", () => {
    const parsed = parseMarketWeatherQuery("?bars=5000&horizon_min=4&horizon_max=120&horizon_step=1");
    const rows = Math.floor((parsed.config.horizonMax - parsed.config.horizonMin) / parsed.config.horizonStep) + 1;
    expect(rows * parsed.config.bars).toBeLessThanOrEqual(120_000);
    expect(parsed.config.horizonStep).toBe(6);
  });

  it("keeps the API query and recipe query on the same analysis parameter builder", () => {
    const recipe = serializeMarketWeatherQuery(DEFAULT_MARKET_WEATHER_QUERY_STATE);
    const analysis = marketWeatherAnalysisParams(DEFAULT_MARKET_WEATHER_QUERY_STATE.config);
    analysis.forEach((value, key) => expect(recipe.get(key)).toBe(value));
    expect([...recipe.keys()][0]).toBe("v");
  });
});
