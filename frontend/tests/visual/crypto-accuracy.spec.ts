import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {readFileSync, writeFileSync} from "node:fs";
const market=JSON.parse(readFileSync(new URL("../../src/pages/__tests__/fixtures/crypto-review.json",import.meta.url),"utf8"));
for(const width of [1050,390]) {
  test(`crypto data meaning and layout at ${width}px`, async({browser},info)=>{
    const context=await browser.newContext({viewport:{width,height:1200},timezoneId:"America/New_York"});
    const page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
    await page.route("**/api/crypto/**",route=>route.fulfill({json:route.request().url().includes("market-overview") ? market : {as_of:"2026-11-20T00:00:00Z",signal_as_of:"2026-11-20T00:00:00Z",summary:{},current_signals:{},market_history:[],signal_history:[]}}));
    await page.route("**/api/aas/**",route=>route.fulfill({json:{components:[],data:{}}}));
    await page.goto("/crypto-indicators");
    await expect(page.getByRole("heading",{name:"Crypto Regime Snapshot"})).toBeVisible();
    await expect(page.getByText("Flight To Quality",{exact:true})).toHaveCount(0);
    await expect(page.getByText(/Observed Nov 20, 2026, 10:00 AM/)).toBeVisible();
    await expect(page.getByText(/Daily bar ·/)).toHaveCount(4);
    await expect(page.getByRole("button",{name:"30D",exact:true})).toBeVisible();await page.getByRole("button",{name:"30D",exact:true}).click();
    await page.getByText(/source and timing/).click();await expect(page.getByText(/including weekends/)).toBeVisible();
    expect(await page.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth)).toBeLessThanOrEqual(1);
    const axe=await new AxeBuilder({page}).include("main").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
    writeFileSync(info.outputPath("axe.json"),JSON.stringify(axe.violations,null,2));
    expect(axe.violations.filter(v=>["serious","critical"].includes(v.impact??""))).toEqual([]);
    await page.screenshot({path:info.outputPath(`crypto-overview-${width}.png`),fullPage:true});
    await page.getByRole("tab",{name:"Deep Dive",exact:true}).click();
    await expect(page.getByText("BTC / SPY Divergence Pressure",{exact:true})).toBeVisible();
    await expect(page.getByText(/does not establish hedging effectiveness/)).toBeVisible();
    await page.screenshot({path:info.outputPath(`crypto-deep-${width}.png`),fullPage:true});
    expect(errors).toEqual([]);await context.close();
  });
}
