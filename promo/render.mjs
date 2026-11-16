// Renders promo.html to a 1080x1920 30fps MP4 using headless Chrome + ffmpeg.
//   npm install puppeteer ffmpeg-static   (or set PROMO_DEPS to a folder that has them)
//   npm start                              (app must be served on :5173)
//   node promo/render.mjs                  -> promo/fabriqon-promo.mp4 + promo/cover.jpg
//   node promo/render.mjs --stills 2,5,9   -> promo/stills/*.jpg for quick review
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PROMO_DEPS ? join(process.env.PROMO_DEPS, 'index.js') : import.meta.url);
const puppeteer = require('puppeteer');
const ffmpegPath = require('ffmpeg-static');

const BASE = process.env.FABRIQON_URL || 'http://localhost:5173';
const FPS = 30;
const args = process.argv.slice(2);
const stillsArg = args.includes('--stills') ? args[args.indexOf('--stills') + 1] : null;

const BUSINESS = {
  name: 'Adunni Couture', owner: 'Adunni Bello', phone: '08012345678', email: '', type: 'Fashion designer',
  country: 'Nigeria', state: 'Lagos', city: 'Lekki', address: '', currency: 'NGN', unit: 'cm', fabricUnit: 'yards', countryCode: '234', logo: '',
};

const browser = await puppeteer.launch({ headless: true, args: ['--hide-scrollbars', '--font-render-hinting=none'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  page.on('requestfailed', (r) => console.error('request failed:', r.url(), r.failure()?.errorText));
  page.on('response', (r) => { if (r.status() >= 400) console.error('HTTP', r.status(), r.url()); });

  // 1. Fresh browser profile: create a demo workspace with sample data.
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(async (business) => {
    localStorage.setItem('fabriqon:persistBannerDismissed', 'true');
    localStorage.setItem('fabriqon:lastBackupAt', JSON.stringify(new Date().toISOString()));
    localStorage.setItem('fabriqon:measureMode', JSON.stringify('focus'));
    const { initWorkspace } = await import('/js/onboarding.js');
    const { loadState } = await import('/js/state.js');
    const { getSetting } = await import('/js/database.js');
    await initWorkspace(business);
    await loadState(getSetting);
    await (await import('/js/seed.js')).seedSampleData();
  }, BUSINESS);
  console.log('Demo workspace seeded.');

  // 2. Load the promo stage.
  await page.goto(`${BASE}/promo/promo.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.promo, { timeout: 30000 });
  await page.evaluate(() => window.promo.ready());
  const duration = await page.evaluate(() => window.promo.DURATION);

  if (stillsArg) {
    const out = join(here, 'stills');
    mkdirSync(out, { recursive: true });
    const times = stillsArg.split(',').map(Number).sort((a, b) => a - b);
    // Step through time so scene setup/actions run exactly as in the video.
    let t = 0;
    for (const target of times) {
      while (t < target) { t = Math.min(target, t + 1 / FPS); await page.evaluate((x) => window.promo.seek(x), t); }
      const buf = await page.screenshot({ type: 'jpeg', quality: 85 });
      writeFileSync(join(out, `t${String(target).replace('.', '_')}.jpg`), buf);
      console.log(`still t=${target}`);
    }
  } else {
    const outFile = join(here, 'fabriqon-promo.mp4');
    const ff = spawn(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
    const frames = Math.round(duration * FPS);
    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      const t = i / FPS;
      await page.evaluate((x) => window.promo.seek(x), t);
      const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (Math.abs(t - 4.9) < 0.5 / FPS) writeFileSync(join(here, 'cover.jpg'), buf);
      if (i % 150 === 0) console.log(`frame ${i}/${frames} (${Math.round((Date.now() - started) / 1000)}s)`);
    }
    ff.stdin.end();
    await new Promise((res, rej) => ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))));
    console.log(`Wrote ${outFile}`);
  }
} finally {
  await browser.close();
}
