// Deterministic renderer: seek(t) -> screenshot -> ffmpeg.
//   node video/render.mjs                      full render (frames, mp4, webm, poster)
//   node video/render.mjs --samples 1,2.5,...  render PNG samples + contact sheets only
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const T = require('./timeline.cjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const scratch = process.env.TALLY_VIDEO_TMP || '/tmp/claude-0/-home-user-tally/b8d26202-3994-57e6-9596-4e6365edc2b7/scratchpad';
const framesDir = path.join(scratch, 'frames');
const outDir = path.join(root, 'site/public/video');
const wav = path.join(here, 'out', 'music.wav');
const url = 'file://' + path.join(here, 'scene.html');
const args = process.argv.slice(2);
const argv = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

const browser = await chromium.launch();
async function mkPage() {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.evaluate(() => window.ready);
  return page;
}
const run = (cmd, a) => { const r = spawnSync(cmd, a, { stdio: 'inherit' }); if (r.status !== 0) throw new Error(cmd + ' failed'); };

fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

if (argv('--samples')) {
  const ts = argv('--samples').split(',').map(Number);
  const page = await mkPage();
  const files = [];
  for (const t of ts) {
    await page.evaluate((x) => window.seek(x), t);
    const f = path.join(framesDir, `sample_${String(t).replace('.', '_')}.png`);
    await page.screenshot({ path: f });
    files.push(f);
  }
  await browser.close();
  const per = 6;
  for (let s = 0; s * per < files.length; s++) {
    const chunk = files.slice(s * per, s * per + per);
    const inputs = chunk.flatMap((f) => ['-i', f]);
    const layout = chunk.map((_, i) => `${(i % 2) * 960}_${Math.floor(i / 2) * 540}`).join('|');
    const scaled = chunk.map((_, i) => `[${i}:v]scale=960:540[v${i}]`).join(';');
    const ins = chunk.map((_, i) => `[v${i}]`).join('');
    const fc = chunk.length === 1 ? `${scaled};[v0]null[o]` : `${scaled};${ins}xstack=inputs=${chunk.length}:layout=${layout}[o]`;
    run('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', fc, '-map', '[o]', path.join(framesDir, `contact_${s}.png`)]);
  }
  console.log('samples in', framesDir);
  process.exit(0);
}

const total = Math.round(T.dur * T.fps);
const W = Math.max(2, Math.min(4, os.cpus().length));
const pages = await Promise.all(Array.from({ length: W }, mkPage));
let done = 0;
await Promise.all(pages.map(async (page, w) => {
  for (let f = w; f < total; f += W) {
    await page.evaluate((x) => window.seek(x), f / T.fps);
    await page.screenshot({ path: path.join(framesDir, `f${String(f).padStart(5, '0')}.png`) });
    if (++done % 100 === 0) console.log(`frames ${done}/${total}`);
  }
}));
await browser.close();

fs.mkdirSync(outDir, { recursive: true });
const hasAudio = fs.existsSync(wav);
if (!hasAudio) console.warn('no video/out/music.wav, run node video/music.mjs first; encoding silent');
const inp = ['-y', '-loglevel', 'error', '-framerate', String(T.fps), '-i', path.join(framesDir, 'f%05d.png'), ...(hasAudio ? ['-i', wav] : [])];
const dur = ['-t', String(T.dur)];
run('ffmpeg', [...inp, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : []), ...dur, path.join(outDir, 'tally-launch.mp4')]);
run('ffmpeg', [...inp, '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p', ...(hasAudio ? ['-c:a', 'libopus', '-b:a', '96k'] : []), ...dur, path.join(outDir, 'tally-launch.webm')]);
const posterT = 39.9;
run('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(framesDir, `f${String(Math.round(posterT * T.fps)).padStart(5, '0')}.png`), '-q:v', '3', path.join(outDir, 'tally-launch-poster.jpg')]);
console.log('done ->', outDir);
