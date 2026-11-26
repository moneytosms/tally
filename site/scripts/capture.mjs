// Records real screenshots (and optional clips) of the running project.
// The skill rewrites the STEPS block per project; keep this shape:
//   1. start the app on seeded/synthetic data (never real user data)
//   2. for each shot: navigate, settle, screenshot into src/assets/screens/
//   3. for each clip: record a context with recordVideo, convert with ffmpeg
// Usage: BASE_URL=http://localhost:5173 node scripts/capture.mjs
// Data: demo mode (sessionStorage tally.demo=1). The app serves an in-memory
// fictional ledger set (src/client/lib/demo.ts). Nothing is sent to a server.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = join(here, "../src/assets/screens");
const CLIPS = join(here, "../public/clips");
mkdirSync(OUT, { recursive: true });
mkdirSync(CLIPS, { recursive: true });

const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
};

const browser = await chromium.launch();

async function phone() {
  const c = await browser.newContext({ ...PHONE, baseURL: BASE });
  // Demo data on, light "paper" theme (src/client/lib/theme.ts: key "tally-theme").
  await c.addInitScript(() => {
    try {
      sessionStorage.setItem("tally.demo", "1");
      localStorage.setItem("tally-theme", "paper");
    } catch {
      /* storage blocked: the shot then shows the welcome screen and is retaken */
    }
  });
  const page = await c.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message));
  return { c, page };
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700); // let entrance animations finish
}
async function shot(page, name, { fullHeight = false } = {}) {
  await settle(page);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: fullHeight });
  console.log("shot", name);
}

// ---- STEPS (demo ledgers: Goa trip = demo-goa, Flat 4B = demo-flat) --------
// 1. ledger detail with expenses
{
  const { c, page } = await phone();
  await page.goto("/ledgers/demo-goa");
  await settle(page);
  // The floating + sits over the last row in a phone shot: hide it for this one frame only.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      const pos = getComputedStyle(el).position;
      if ((pos === "fixed" || pos === "absolute") && r.left > 200 && r.top > 600 && r.width < 120 && r.height < 120)
        el.style.display = "none";
    }
  });
  await shot(page, "ledger");
  await c.close();
}
// 2. expense editor on a shares-mode expense (Scooter rental: 2:1:1)
{
  const { c, page } = await phone();
  await page.goto("/ledgers/demo-goa");
  await settle(page);
  await page.getByRole("button", { name: /Scooter rental/ }).click();
  await page.getByRole("link", { name: "Edit expense" }).click();
  await page.waitForURL(/\/expenses\//);
  await shot(page, "expense");
  await c.close();
}
// 3. settle screen with the transfer plan
{
  const { c, page } = await phone();
  await page.goto("/ledgers/demo-goa/settle");
  await shot(page, "settle-plan");
  await c.close();
}
// 4. a transfer's why trail expanded
{
  const { c, page } = await phone();
  await page.goto("/ledgers/demo-goa/settle");
  await settle(page);
  await page.locator("details summary").first().click();
  await shot(page, "why-trail");
  await c.close();
}
// 5. insights (lazy Recharts)
{
  const { c, page } = await phone();
  await page.goto("/ledgers/demo-goa/insights");
  await page.locator("svg").first().waitFor({ state: "visible" }).catch(() => {});
  await shot(page, "insights");
  await c.close();
}
// 6. You tab: theme picker
{
  const { c, page } = await phone();
  await page.goto("/you");
  await settle(page);
  // The picker sits below the profile and security cards: bring its heading to the top.
  await page.getByRole("heading", { name: "Theme", exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find((e) => e.textContent?.trim() === "Theme");
    h?.scrollIntoView({ block: "start" });
  });
  await shot(page, "themes");
  await c.close();
}
// Clip example: record, then `ffmpeg -i in.webm -c:v libvpx-vp9 -b:v 0 -crf 36 -an public/clips/NAME.webm`
// and `ffmpeg -i in.webm -c:v libx264 -crf 28 -pix_fmt yuv420p -an public/clips/NAME.mp4`.
// ----------------------------------------------------------------------------
await browser.close();
