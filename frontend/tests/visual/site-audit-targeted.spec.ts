import { test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const AUDIT_ROOT = path.resolve(
  process.cwd(),
  "..",
  "artifacts",
  "site-audit",
  "2026-07-29",
);
const LIVE_ORIGIN = "https://marketdiagnostictool.com";

async function proxyLiveApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const localUrl = new URL(route.request().url());
    const upstreamUrl = new URL(`${localUrl.pathname}${localUrl.search}`, LIVE_ORIGIN).toString();
    try {
      const response = await route.fetch({ url: upstreamUrl, timeout: 120_000 });
      await route.fulfill({ response });
    } catch {
      await route.abort("failed");
    }
  });
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(1_000);
}

test.setTimeout(5 * 60_000);

test("verify navigation behavior and mobile overflow", async ({ browser }) => {
  await mkdir(path.join(AUDIT_ROOT, "screenshots"), { recursive: true });

  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
  });
  const desktop = await desktopContext.newPage();
  await proxyLiveApi(desktop);
  await desktop.goto("/");
  await settle(desktop);

  const toolsButton = desktop.getByRole("button", { name: "Tools" });
  await toolsButton.hover();
  const toolsAfterHover = await toolsButton.getAttribute("aria-expanded");
  await toolsButton.click();
  const toolsAfterPointerClick = await toolsButton.getAttribute("aria-expanded");
  await desktop.mouse.move(20, 300);
  await toolsButton.focus();
  await desktop.keyboard.press("Enter");
  const toolsAfterKeyboardEnter = await toolsButton.getAttribute("aria-expanded");

  await desktopContext.close();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "dark",
  });
  const mobile = await mobileContext.newPage();
  await proxyLiveApi(mobile);
  await mobile.goto("/system-breakdown");
  await settle(mobile);

  const overflow = await mobile.evaluate(() => {
    const describe = (element: Element) => {
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && parts.length < 5) {
        let part = current.tagName.toLowerCase();
        if (current.id) {
          part += `#${current.id}`;
        } else if (current.classList.length > 0) {
          part += `.${Array.from(current.classList).slice(0, 3).join(".")}`;
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    };

    const offenders = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          selector: describe(element),
          tag: element.tagName.toLowerCase(),
          text: element.innerText?.replace(/\s+/g, " ").trim().slice(0, 120) ?? "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          top: Math.round(rect.top + window.scrollY),
          width: Math.round(rect.width),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          overflowX: style.overflowX,
          whiteSpace: style.whiteSpace,
        };
      })
      .filter(
        (item) =>
          item.right > window.innerWidth + 1 ||
          item.left < -1 ||
          item.scrollWidth > item.clientWidth + 1,
      )
      .sort((a, b) => b.right - a.right || b.scrollWidth - a.scrollWidth)
      .slice(0, 40);

    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      overflowPixels: document.documentElement.scrollWidth - window.innerWidth,
      offenders,
    };
  });

  const firstSpecificOffender = overflow.offenders.find(
    (item) => item.tag !== "html" && item.tag !== "body" && item.top > 0,
  );
  if (firstSpecificOffender) {
    await mobile.evaluate(
      ({ top, overflowPixels }) => {
        window.scrollTo({ top: Math.max(0, top - 120), left: overflowPixels });
      },
      { top: firstSpecificOffender.top, overflowPixels: overflow.overflowPixels },
    );
    await mobile.waitForTimeout(300);
    await mobile.screenshot({
      path: path.join(
        AUDIT_ROOT,
        "screenshots",
        "05-system-breakdown-mobile-overflow-evidence.png",
      ),
      animations: "disabled",
      caret: "hide",
    });
  }

  await mobileContext.close();

  await writeFile(
    path.join(AUDIT_ROOT, "targeted-verification.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        desktopTools: {
          afterHover: toolsAfterHover,
          afterPointerClick: toolsAfterPointerClick,
          afterKeyboardEnter: toolsAfterKeyboardEnter,
        },
        systemBreakdownMobile: overflow,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
});
