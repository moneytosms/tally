// Records real screenshots (and optional clips) of the running project.
// The skill rewrites the STEPS block per project; keep this shape:
//   1. start the app on seeded/synthetic data (never real user data)
//   2. for each shot: navigate, settle, screenshot into src/assets/screens/
//   3. for each clip: record a context with recordVideo, convert with ffmpeg
// Usage: BASE_URL=http://localhost:3000 node scripts/capture.mjs
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

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const browser = await chromium.launch();
const ctx = (device, dark = false) => browser.newContext({ ...device, baseURL: BASE, colorScheme: dark ? "dark" : "light" });

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600); // let entrance animations finish
}
async function shot(page, name) {
  await settle(page);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log("shot", name);
}

// ---- STEPS (replace per project) -------------------------------------------
{
  const c = await ctx(DESKTOP);
  const page = await c.newPage();
  await page.goto("/");
  await shot(page, "hero");
  await c.close();
}
// Clip example: record, then `ffmpeg -i in.webm -c:v libvpx-vp9 -b:v 0 -crf 36 -an public/clips/NAME.webm`
// and `ffmpeg -i in.webm -c:v libx264 -crf 28 -pix_fmt yuv420p -an public/clips/NAME.mp4`.
// ----------------------------------------------------------------------------
await browser.close();
