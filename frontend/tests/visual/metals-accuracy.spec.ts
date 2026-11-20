import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
const fixture=JSON.parse(readFileSync(new URL("./fixtures/metals-review.json",import.meta.url),"utf8"));
for(const width of [1050,1360,390]){
 test(`metals portrait rows and data labels at ${width}px`,async({browser},info)=>{
  const context=await browser.newContext({viewport:{width,height:1400},timezoneId:"America/New_York"});const page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/api/precious-metals/**",route=>{const u=new URL(route.request().url()).pathname;const body=u.endsWith("/regime")?fixture.regime:u.endsWith("projections/latest")?fixture.projections:u.endsWith("futures-curve")?{as_of:null,metals:[],source:"fixture"}:u.endsWith("/correlations")?null:[];return route.fulfill({json:body});});
  await page.goto("/metals-indicators");await expect(page.getByRole("heading",{name:"Winners & Losers Right Now"})).toBeVisible();
  for(const name of ["precious-metal-grid","industrial-metal-grid"]){const cards=page.getByTestId(name).locator("[data-metal]");await expect(cards).toHaveCount(3);const boxes=await cards.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,left:r.left,width:r.width}}));if(width>=1024){expect(Math.max(...boxes.map(b=>b.top))-Math.min(...boxes.map(b=>b.top))).toBeLessThan(2);expect(boxes[1].left).toBeGreaterThan(boxes[0].left);}else expect(boxes[1].top).toBeGreaterThan(boxes[0].top);}
  await expect(page.getByText(/None of the 6 tracked metals has positive momentum/).first()).toBeVisible();
  expect(await page.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth)).toBeLessThanOrEqual(1);
  const axe=await new AxeBuilder({page}).include("main").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();expect(axe.violations.filter(v=>["serious","critical"].includes(v.impact??""))).toEqual([]);expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath(`metals-${width}.png`),fullPage:true});await context.close();
 });
}