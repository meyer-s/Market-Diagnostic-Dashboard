import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConvictionSnapshot } from "./ConvictionSnapshot";
import { OptionalityMispricingWidget } from "./OptionalityMispricingWidget";
import { OptionsStructureMap } from "./OptionsStructureMap";
import { PriceAnalysisChart } from "./PriceAnalysisChart";
import { TechnicalIndicators } from "./TechnicalIndicators";

afterEach(cleanup);

const technicalFixture = {
  lookback_days: 252,
  current_price: 106,
  high_52w: 120,
  low_52w: 80,
  sma_50: 103,
  sma_200: 98,
  trend: "uptrend",
  rsi: { current: 55, status: "neutral", series: [50, 52, 55] },
  macd: {
    current: 0.5,
    signal: 0.4,
    histogram: 0.1,
    status: "bullish",
    macd_series: [0.3, 0.4, 0.5],
    signal_series: [0.3, 0.35, 0.4],
    histogram_series: [0, 0.05, 0.1],
  },
  candles: [
    { date: "2026-07-29", open: 98, high: 120, low: 80, close: 100, volume: 1_000 },
    { date: "2026-07-30", open: 100, high: 120, low: 80, close: 104, volume: 1_100 },
    { date: "2026-07-31", open: 104, high: 120, low: 80, close: 106, volume: 1_200 },
  ],
};

const intradayFixture = technicalFixture.candles.flatMap((candle) =>
  [13, 15, 17, 19].map((hour, index) => ({
    timestamp: `${candle.date}T${hour}:30:00Z`,
    open: candle.open + index * 0.5,
    high: 120,
    low: 80,
    close: candle.close - 1.5 + index * 0.5,
  })),
);

describe("stock accuracy widgets", () => {
  it("presents price bands as non-actionable references and hardens crossed bands", () => {
    render(
      <PriceAnalysisChart
        latestClose={100}
        upperReference={90}
        lowerReference={110}
        trailingReturn={2.5}
        horizon="21D"
      />
    );

    expect(screen.getByText("Latest Close")).not.toBeNull();
    expect(screen.getByText("Trailing Price Return")).not.toBeNull();
    expect(screen.getByText("Upper Reference")).not.toBeNull();
    expect(screen.getByText("Lower Reference")).not.toBeNull();
    expect(screen.getByText("Upper / Lower")).not.toBeNull();
    expect(screen.getByText("n/a")).not.toBeNull();
    expect(screen.getByText("-10.0%")).not.toBeNull();
    expect(screen.getAllByText("+10.0%").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Trade Target|Stop Loss|Risk\/Reward/)).toBeNull();
    expect(screen.queryByText(/Reference basis|technical extension/i)).toBeNull();
  });

  it("stacks analyst reference context before the range visualization on narrow screens", () => {
    render(
      <PriceAnalysisChart
        latestClose={100}
        upperReference={105}
        lowerReference={90}
        trailingReturn={-1.2}
        horizon="21D"
        analystTarget={103}
        analystCount={12}
      />
    );

    const analystContext = screen.getByTestId("analyst-reference-context");
    expect(analystContext.className).toContain("flex-col");
    expect(analystContext.className).toContain("sm:flex-row");
    expect(screen.getByText("Analyst reference: $103.00 (12)")).not.toBeNull();
    expect(screen.getByText("Reference alignment: Aligned")).not.toBeNull();
  });

  it("labels composite signal quality and direction without advice or probability language", () => {
    const { container } = render(
      <ConvictionSnapshot signalQuality={56} score={60} volatility={22} horizon="3M" />
    );

    expect(screen.getByText("Signal Quality")).not.toBeNull();
    expect(screen.getByText("Composite")).not.toBeNull();
    expect(screen.getByText("56/100")).not.toBeNull();
    expect(screen.getByText("Bullish")).not.toBeNull();
    expect(screen.getByText("Model Score")).not.toBeNull();
    expect(screen.getByText("Quality drivers")).not.toBeNull();
    expect(screen.getByRole("img", { name: /component consistency 40 percent.*realized volatility 35 percent.*directional strength 25 percent/i })).not.toBeNull();
    expect(screen.queryByText("Why?")).toBeNull();
    expect(container.textContent).not.toMatch(/Strong Buy|\bBuy\b|Strong Sell|\bSell\b|Confidence|Conviction|Signal Coherence|Alignment/);
  });

  it("fails closed on low-quality options while retaining raw context and provenance", () => {
    const { container } = render(
      <OptionalityMispricingWidget
        metrics={{
          iv30: 12,
          hv30: 24,
          iv_percentile: null,
          iv30_chain_percentile: 18,
          iv30_chain_percentile_kind: "current_chain_cross_section",
          iv_percentile_kind: "retired_ambiguous_field",
          avg_edr: 32,
          observed_at: "2026-08-01T16:00:00Z",
          data_source: "yahoo",
          fallback_reason: "Primary feed unavailable",
          quality_status: "limited",
          quality_reasons: ["last-price-only quotes"],
          component_usable: {
            iv30: true,
            iv_percentile: false,
            iv30_chain_percentile: true,
            avg_edr: true,
            mispricing: false,
          },
        }}
      />
    );

    expect(screen.getByText("Options Pricing Context")).not.toBeNull();
    expect(screen.getByText("Unavailable")).not.toBeNull();
    expect(screen.getByText("Insufficient quality")).not.toBeNull();
    expect(screen.getByText("Chain IV Position")).not.toBeNull();
    expect(screen.getByText("Current quotes only")).not.toBeNull();
    expect(screen.getByText("Extrinsic Share")).not.toBeNull();
    expect(screen.getByText(/Yahoo · limited · Aug 1/i)).not.toBeNull();
    expect(screen.getByText("12.0% / 24.0%")).not.toBeNull();
    expect(screen.getByText("-12.0 pts").className).toContain("text-stealth-300");
    expect(screen.queryByText("Vol Spread")).toBeNull();
    expect(container.textContent).not.toMatch(/\bCheap\b|Fairly Valued|\bExpensive\b|Optionality Mispricing|Avg EDR/);
  });

  it("labels a usable neutral options-pricing read as balanced", () => {
    render(
      <OptionalityMispricingWidget
        metrics={{
          iv30: 20,
          hv30: 20,
          iv_percentile: null,
          iv30_chain_percentile: 50,
          iv30_chain_percentile_kind: "current_chain_cross_section",
          iv_percentile_kind: "retired_ambiguous_field",
          avg_edr: 50,
          quality_status: "good",
          mispricing_usable: true,
        }}
      />
    );

    expect(screen.getByText("Balanced")).not.toBeNull();
    expect(screen.queryByText("Fairly Valued")).toBeNull();
  });

  it("identifies moving-average structure as EMA evidence", () => {
    render(
      <OptionsStructureMap
        currentPrice={100}
        sma50={95}
        sma200={90}
        label="TEST"
      />
    );

    expect(screen.getAllByText("EMA50").length).toBeGreaterThan(0);
    expect(screen.getAllByText("EMA200").length).toBeGreaterThan(0);
    expect(screen.getByText(/EMA50 \$95\.00 · EMA200 \$90\.00/)).not.toBeNull();
    expect(screen.queryByText(/50-day average|200-day average/)).toBeNull();
  });

  it("reveals exact call and put wall context on pointer and touch", () => {
    const { container } = render(
      <OptionsStructureMap
        currentPrice={100}
        callWalls={[
          { strike: 105, open_interest: 20_000, volume: 8_000 },
          { strike: 110, open_interest: 12_000, volume: 4_000 },
          { strike: 115, open_interest: 8_000, volume: 2_000 },
          { strike: 120, open_interest: 1_000, volume: 500 },
        ]}
        putWalls={[
          { strike: 95, open_interest: 16_000, volume: 6_000 },
        ]}
        label="TEST"
      />,
    );

    const callWall = container.querySelector<SVGGElement>(
      '[data-testid="structure-level"][data-kind="call-wall"][data-price="110"]',
    );
    expect(callWall).not.toBeNull();
    expect(
      container.querySelector('[data-testid="structure-level"][data-price="120"]'),
    ).toBeNull();

    fireEvent.pointerEnter(callWall as SVGGElement, { pointerType: "mouse" });
    let tooltip = container.querySelector('[data-testid="structure-level-tooltip"]');
    expect(tooltip?.textContent).toContain("CALL WALL");
    expect(tooltip?.textContent).toContain("$110");
    expect(tooltip?.textContent).toContain("10.0% above current price");
    expect(tooltip?.textContent).toContain("OI 12K · Volume 4K");

    fireEvent.pointerLeave(callWall as SVGGElement, { pointerType: "mouse" });
    expect(container.querySelector('[data-testid="structure-level-tooltip"]')).toBeNull();

    const putWall = container.querySelector<SVGGElement>(
      '[data-testid="structure-level"][data-kind="put-wall"][data-price="95"]',
    );
    fireEvent.pointerDown(putWall as SVGGElement, { pointerType: "touch" });
    fireEvent.pointerLeave(putWall as SVGGElement, { pointerType: "touch" });
    tooltip = container.querySelector('[data-testid="structure-level-tooltip"]');
    expect(tooltip?.textContent).toContain("PUT WALL");
    expect(tooltip?.textContent).toContain("$95.00");
    expect(tooltip?.textContent).toContain("5.0% below current price");

    fireEvent.pointerDown(putWall as SVGGElement, { pointerType: "touch" });
    expect(container.querySelector('[data-testid="structure-level-tooltip"]')).toBeNull();
  });

  it("reveals non-primary metals levels without inventing options evidence", () => {
    const { container } = render(
      <OptionsStructureMap
        currentPrice={100}
        priceLabel="Spot price"
        movingAverageType="SMA"
        supportLevels={[95, 90, 85]}
        resistanceLevels={[105, 110, 115]}
        sma50={97}
        sma200={92}
        label="METAL"
      />,
    );

    const nextResistance = container.querySelector<SVGGElement>(
      '[data-testid="structure-level"][data-kind="resistance-level"][data-price="110"]',
    );
    fireEvent.pointerEnter(nextResistance as SVGGElement, { pointerType: "mouse" });

    const tooltip = container.querySelector('[data-testid="structure-level-tooltip"]');
    expect(tooltip?.textContent).toContain("RESISTANCE LEVEL");
    expect(tooltip?.textContent).toContain("$110");
    expect(tooltip?.textContent).toContain("10.0% above spot price");
    expect(tooltip?.textContent).toContain("Recent swing level");
    expect(tooltip?.textContent).not.toContain("OI");
    expect(container.querySelector("desc")?.textContent).toContain("Available humps");
    expect(container.querySelector("desc")?.textContent).toContain("$85.00");
    expect(screen.getAllByText("SMA50").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SMA200").length).toBeGreaterThan(0);
    expect(screen.getByText(/SMA50 \$97\.00 · SMA200 \$92\.00/)).not.toBeNull();
    expect(screen.queryByText(/EMA50|EMA200/)).toBeNull();
  });

  it("supports single-stop keyboard inspection in visual price order", () => {
    const { container } = render(
      <OptionsStructureMap
        currentPrice={100}
        priceLabel="Latest close"
        callWalls={[
          { strike: 105, open_interest: 20_000 },
          { strike: 110, open_interest: 12_000 },
        ]}
        putWalls={[
          { strike: 95, open_interest: 16_000 },
          { strike: 90, open_interest: 8_000 },
        ]}
        label="TEST"
      />,
    );

    const chart = screen.getByRole("img", { name: /Market structure band/i });
    const liveRegion = container.querySelector('[data-testid="structure-level-live-region"]');
    expect(chart.getAttribute("tabindex")).toBe("0");
    expect(chart.getAttribute("aria-keyshortcuts")).toContain("ArrowUp");

    fireEvent.focus(chart);
    expect(liveRegion?.textContent).toMatch(/Call wall at \$105.*5\.0% above latest close/i);
    expect(container.querySelector('[data-testid="structure-level-tooltip"]')).not.toBeNull();

    fireEvent.keyDown(chart, { key: "ArrowUp" });
    expect(liveRegion?.textContent).toMatch(/Call wall at \$110.*Level 1 of 4/i);

    fireEvent.keyDown(chart, { key: "End" });
    expect(liveRegion?.textContent).toMatch(/Put wall at \$90.*Level 4 of 4/i);

    fireEvent.keyDown(chart, { key: "Escape" });
    expect(container.querySelector('[data-testid="structure-level-tooltip"]')).toBeNull();
  });

  it("uses the stale-aware close label in visible and accessible price context", () => {
    const candles = [
      { date: "2026-07-31", open: 99, high: 101, low: 98, close: 100, volume: 1_000 },
      { date: "2026-08-01", open: 100, high: 102, low: 99, close: 101, volume: 1_100 },
    ];
    const { container } = render(
      <TechnicalIndicators
        closeLabel="Last Available Close"
        technicalData={{
          lookback_days: 252,
          current_price: 101,
          high_52w: 120,
          low_52w: 80,
          sma_50: 98,
          sma_200: 95,
          trend: "uptrend",
          rsi: { current: 55, status: "neutral", series: [50, 55] },
          macd: {
            current: 0.5,
            signal: 0.4,
            histogram: 0.1,
            status: "bullish",
            macd_series: [0.3, 0.5],
            signal_series: [0.3, 0.4],
            histogram_series: [0, 0.1],
          },
          candles,
        }}
        priceHistory={candles}
        hideOptionsContext
      />
    );

    expect(screen.getByText("Last Available Close")).not.toBeNull();
    expect(screen.getByRole("group", { name: "Price history window" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "252D" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "1Y" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "252D" }).className).toContain("min-h-11");
    expect(screen.getByRole("img", {
      name: /Price history.*Last Available Close is \$101\.00/i,
    })).not.toBeNull();
    expect(screen.getByText("0 proxy bars")).not.toBeNull();
    expect(screen.queryByText("Latest Close")).toBeNull();
    expect(container.textContent).not.toContain("flow markers");
  });

  it("renders daily proxy evidence once, groups nearby bars, and preserves relative event data", () => {
    const { container } = render(
      <TechnicalIndicators
        technicalData={technicalFixture}
        priceHistory={technicalFixture.candles}
        intradayHistory2h={intradayFixture}
        flowEvents={[
          {
            date: "2026-07-29",
            price: 92,
            volume: 10_000,
            notional: 1_000_000,
            volume_z: 2.2,
            side: "sell",
            strength: 1.7,
          },
          {
            date: "2026-07-30",
            price: 105,
            volume: 20_000,
            notional: 2_000_000,
            volume_z: 2.8,
            side: "buy",
            strength: 2.1,
          },
          {
            date: "2026-07-31",
            price: 106,
            volume: 80_000,
            notional: 8_000_000,
            volume_z: 3.4,
            side: "buy",
            strength: 2.8,
          },
          {
            date: "2026-07-28",
            price: 95,
            volume: 50_000,
            notional: 5_000_000,
            volume_z: 3,
            side: "sell",
            strength: 2.4,
          },
        ]}
        hideOptionsContext
      />,
    );

    expect(screen.getByText("2 clusters · 3 bars · notional-scaled")).not.toBeNull();
    expect(screen.queryByText("Bubble area = relative flagged notional")).toBeNull();
    expect(screen.getByTestId("price-history-header").className).toContain("flex-col");

    const clusters = container.querySelectorAll('[data-testid="proxy-cluster"]');
    const bubbles = container.querySelectorAll('[data-testid="proxy-event-bubble"]');
    const halos = container.querySelectorAll('[data-testid="proxy-cluster-halo"]');
    expect(clusters).toHaveLength(2);
    expect(bubbles).toHaveLength(3);
    expect(halos).toHaveLength(1);
    expect(halos[0]?.getAttribute("clip-path")).toMatch(/^url\(#technical.*-proxy-plot-clip\)$/);
    expect(
      container.querySelectorAll('[data-event-date="2026-07-29"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-event-date="2026-07-28"]'),
    ).toHaveLength(0);
    expect(
      Array.from(clusters).map((cluster) => cluster.getAttribute("data-cluster-events")),
    ).toEqual(expect.arrayContaining(["1", "2"]));

    const sellBubble = container.querySelector<SVGGElement>(
      '[data-testid="proxy-event-bubble"][data-event-date="2026-07-29"]',
    );
    const smallerBuyBubble = container.querySelector<SVGGElement>(
      '[data-testid="proxy-event-bubble"][data-event-date="2026-07-30"]',
    );
    const largerBuyBubble = container.querySelector<SVGGElement>(
      '[data-testid="proxy-event-bubble"][data-event-date="2026-07-31"]',
    );
    expect(sellBubble?.getAttribute("data-event-side")).toBe("sell");
    expect(sellBubble?.getAttribute("data-event-price")).toBe("92");
    expect(sellBubble?.getAttribute("data-event-notional")).toBe("1000000");
    expect(largerBuyBubble?.getAttribute("data-event-side")).toBe("buy");
    expect(largerBuyBubble?.getAttribute("data-event-notional")).toBe("8000000");

    const sellCircles = sellBubble?.querySelectorAll("circle") ?? [];
    const smallerBuyCircles = smallerBuyBubble?.querySelectorAll("circle") ?? [];
    const largerBuyCircles = largerBuyBubble?.querySelectorAll("circle") ?? [];
    const sellInner = sellCircles[1];
    const smallerBuyInner = smallerBuyCircles[1];
    const largerBuyInner = largerBuyCircles[1];
    const expectedSellY = 20 + (1 - (92 - (80 - 3.2)) / (40 + 6.4)) * 240;
    const finalSellCandleY = 20 + (1 - (100 - (80 - 3.2)) / (40 + 6.4)) * 240;
    expect(Number(sellInner?.getAttribute("cy"))).toBeCloseTo(expectedSellY, 5);
    expect(Number(sellInner?.getAttribute("cy"))).not.toBeCloseTo(finalSellCandleY, 3);
    expect(Number(largerBuyInner?.getAttribute("r"))).toBeGreaterThan(
      Number(smallerBuyInner?.getAttribute("r")),
    );
    expect(sellCircles[0]?.getAttribute("stroke-dasharray")).toBe("4 2");
    expect(smallerBuyCircles[0]?.getAttribute("stroke-dasharray")).toBeNull();

    const clusterTitles = Array.from(
      container.querySelectorAll('[data-testid="proxy-cluster"] > title'),
    ).map((title) => title.textContent ?? "");
    expect(clusterTitles.some((title) => /Positive-bar proxy cluster/.test(title))).toBe(true);
    expect(clusterTitles.some((title) => /Negative-bar proxy cluster/.test(title))).toBe(true);
    expect(clusterTitles.some((title) => /2 qualifying bars/.test(title))).toBe(true);
    expect(clusterTitles.some((title) => /10M flagged-bar notional/.test(title))).toBe(true);
    expect(clusterTitles.some((title) => /weighted price \$105\.80/.test(title))).toBe(true);

    const priceChart = screen.getByRole("img", {
      name: /Price history.*3 qualifying high-volume bars are grouped into 2 proximity clusters/i,
    });
    const priceScroller = screen.getByRole("region", { name: "Price history chart" });
    const liveRegion = container.querySelector('[data-testid="proxy-cluster-live-region"]');
    expect(priceChart.getAttribute("tabindex")).toBe("0");
    expect(liveRegion?.textContent).toMatch(/2 proximity clusters contain 3 qualifying bars/i);

    Object.defineProperties(priceScroller, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 800 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
      scrollTo: {
        configurable: true,
        value: vi.fn(({ left }: ScrollToOptions) => {
          priceScroller.scrollLeft = left ?? 0;
        }),
      },
    });
    vi.spyOn(priceScroller, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 320,
      height: 300,
      top: 0,
      right: 320,
      bottom: 300,
      left: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(priceChart, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 800,
      height: 240,
      top: 0,
      right: 800,
      bottom: 240,
      left: 0,
      toJSON: () => ({}),
    });

    fireEvent.focus(priceChart);
    expect(priceScroller.scrollTo).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="proxy-cluster-tooltip"]')).not.toBeNull();
    expect(liveRegion?.textContent).toMatch(/Negative-bar proxy cluster/i);

    fireEvent.keyDown(priceChart, { key: "ArrowRight" });
    expect(liveRegion?.textContent).toMatch(/Positive-bar proxy cluster/i);
    expect(liveRegion?.textContent).toMatch(/rank 1 of 2/i);

    fireEvent.keyDown(priceChart, { key: "Escape" });
    expect(container.querySelector('[data-testid="proxy-cluster-tooltip"]')).toBeNull();
  });
});
