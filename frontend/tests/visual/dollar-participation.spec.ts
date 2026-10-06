import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";


const history = Array.from({ length: 180 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 1, 2 + index));
  const dxyMove = Math.sin(index / 18) * 2 + index * 0.01;
  const bull = Math.max(0, Math.sin(index / 11) * 1.8);
  const bear = Math.max(0, Math.cos(index / 15) * 1.6);
  return {
    date: date.toISOString().slice(0, 10),
    dxy_close: 98 + dxyMove,
    dxy_indexed: 100 + dxyMove,
    dxy_return_20d_pct: Math.sin(index / 22) * 2.4,
    bull_activity_z: bull - 0.3,
    bear_activity_z: bear - 0.2,
    bull_excess: bull,
    bear_excess: bear,
    bear_plot: -bear,
    participation_tilt: bull - bear,
    participation_intensity: bull + bear,
    bull_activity_ratio: 1 + bull * 0.5,
    bear_activity_ratio: 1 + bear * 0.5,
    same_day_association_63d: -0.18,
    regime: index > 160 ? "bear_against_price" : "balanced",
    regime_label: index > 160 ? "Bear-heavy while DXY rose" : "No unusual relationship",
  };
});

const fixture = {
  as_of: history.at(-1)?.date,
  generated_at: "2026-10-06T14:00:00Z",
  period: { requested_sessions: 504, returned_sessions: history.length, start_date: history[0].date, end_date: history.at(-1)?.date },
  current: { regime: "bear_against_price", regime_label: "Bear-heavy while DXY rose", summary: "DXY rose while unusual activity was heavier in the bearish product. This is a divergence in observed activity, not a reversal signal.", dxy_level: 99.4, dxy_return_20d_pct: 1.8, bull_activity_z: 0.4, bear_activity_z: 2.1, bull_activity_ratio: 1.1, bear_activity_ratio: 3.2, bull_dollar_activity: 42_000_000, bear_dollar_activity: 8_000_000, participation_tilt: -1.7, participation_intensity: 2.5, same_day_association_63d: -0.18 },
  history,
  episodes: [{ start_date: history[150].date, end_date: history[166].date, sessions: 17, regime: "bear_against_price", label: "Bear-heavy while DXY rose", dxy_change_pct: 1.6, average_tilt: -1.4, average_bull_excess: 0.3, average_bear_excess: 1.7 }],
  instruments: [
    { code: "DXY", provider_symbol: "DX-Y.NYB", name: "ICE U.S. Dollar Index", role: "Price benchmark", direction: "U.S. dollar vs. six-currency basket", leverage: "Index; not a fund", observations_returned: 270, shared_observations: 265, normalization: "Indexed to 100 in the selected window" },
    { code: "UUP", provider_symbol: "UUP", name: "Invesco DB US Dollar Index Bullish Fund", role: "Bullish activity proxy", direction: "Long USDX futures exposure", leverage: "1x directional; not leveraged", observations_returned: 270, shared_observations: 265, normalization: "Own 63-session robust baseline" },
    { code: "UDN", provider_symbol: "UDN", name: "Invesco DB US Dollar Index Bearish Fund", role: "Bearish activity proxy", direction: "Short USDX futures exposure", leverage: "1x inverse directional; not leveraged", observations_returned: 268, shared_observations: 265, normalization: "Own 63-session robust baseline" },
  ],
  data_quality: { status: "ok", provider: "yahoo", price_field: "Adjusted daily close", volume_field: "Reported daily share volume", alignment: "Exact shared market date; no forward fill", shared_observations_before_scoring: 265, warnings: [] },
  methodology: { activity: "Activity is not positioning.", normalization: "Each product uses its own baseline.", tilt: "Above-baseline UUP minus above-baseline UDN.", regimes: "Descriptive thresholds only.", fund_size: "Not AUM turnover.", instrument_choice: "Matched pair.", tracking: "Futures carry and roll can separate the funds from DXY.", association: "Descriptive correlation." },
  sources: [{ label: "ICE U.S. Dollar Index methodology", url: "https://www.ice.com/", role: "DXY definition" }],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/dollar-participation?**", (route) => route.fulfill({ json: fixture }));
});

test("renders an accessible participation field at desktop and mobile", async ({ page }) => {
  await page.goto("/dollar-participation");
  await expect(page.getByRole("heading", { level: 1, name: "Dollar Participation" })).toBeVisible();
  await expect(page.getByText("Bear-heavy while DXY rose").first()).toBeVisible();
  await expect(page.getByText("Two sides, kept separate")).toBeVisible();

  const desktop = await new AxeBuilder({ page }).analyze();
  expect(desktop.violations).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("group", { name: "History window" })).toBeVisible();
  await expect(page.getByText(/Chart scrolls horizontally for the full history/)).toBeVisible();
  const currentReadPrecedesChart = await page.evaluate(() => {
    const currentRead = document.querySelector("#current-read-title")?.closest("section");
    const chart = document.querySelector('[aria-label="Scrollable dollar participation chart"]');
    return Boolean(currentRead && chart && (currentRead.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(currentReadPrecedesChart).toBe(true);
  await expect(page.getByRole("heading", { name: "Instrument audit" })).toBeVisible();
  const mobile = await new AxeBuilder({ page }).analyze();
  expect(mobile.violations).toEqual([]);
});
