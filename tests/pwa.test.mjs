import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAppFiles } from '../tools/build-sw.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw = readFileSync(join(root, 'service-worker.js'), 'utf8');
const precache = [...sw.matchAll(/^\s+'([^']+)',$/gm)].map(m => m[1]);

test('service worker precaches every app file (run `npm run build:sw` if this fails)', () => {
  const missing = listAppFiles().filter(f => !precache.includes(f));
  assert.deepEqual(missing, []);
  assert.ok(precache.includes('./'));
  assert.ok(precache.includes('js/vendor/jspdf.umd.min.js'), 'PDF library available offline');
  assert.ok(precache.includes('js/vendor/xlsx.full.min.js'), 'Excel library available offline');
  assert.ok(precache.includes('js/vendor/chart.umd.js'), 'chart library available offline');
  assert.doesNotMatch(sw, /const VERSION = 'dev'/, 'version hash generated');
});

test('every precached path exists', () => {
  for (const f of precache.filter(f => f !== './')) assert.ok(existsSync(join(root, f)), f);
});

test('manifest is installable', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.name && m.short_name && m.start_url);
  const sizes = m.icons.map(i => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(existsSync(join(root, i.src)), i.src);
});

test('app never loads code from a CDN', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  assert.doesNotMatch(html, /<link[^>]+href="https?:/);
  assert.match(html, /script-src 'self'/);
});
