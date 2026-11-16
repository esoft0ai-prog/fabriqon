// Regenerates the PRECACHE list and VERSION hash in service-worker.js from
// the files on disk, so every app file is available offline and any change
// produces a new service worker (which triggers the in-app update prompt).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INCLUDE_DIRS = ['css', 'js', 'assets'];
const ROOT_FILES = ['index.html', 'offline.html', 'manifest.json'];

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

export function listAppFiles() {
  const files = [...ROOT_FILES.map((f) => join(root, f)), ...INCLUDE_DIRS.flatMap((d) => walk(join(root, d)))]
    .filter((p) => !/\.(map|md)$/.test(p) && !p.endsWith('.DS_Store'));
  return files.map((p) => relative(root, p).split('\\').join('/')).sort();
}

export function build() {
  const files = listAppFiles();
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update(readFileSync(join(root, f)));
  const swPath = join(root, 'service-worker.js');
  const swSrc = readFileSync(swPath, 'utf8');
  // Hash the worker's own logic too (excluding the generated block).
  hash.update(swSrc.replace(/\/\/ <generated>[\s\S]*?\/\/ <\/generated>/, ''));
  const version = hash.digest('hex').slice(0, 12);
  const block = `// <generated>\nconst VERSION = '${version}';\nconst PRECACHE = [\n  './',\n${files.map((f) => `  '${f}',`).join('\n')}\n];\n// </generated>`;
  writeFileSync(swPath, swSrc.replace(/\/\/ <generated>[\s\S]*?\/\/ <\/generated>/, block));
  return { version, count: files.length + 1 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { version, count } = build();
  console.log(`service-worker.js: ${count} files precached, version ${version}`);
}
