// Parses every app ES module with Node to catch syntax errors and broken
// relative imports (missing files / missing named exports) without a browser.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'vendor' ? [] : walk(p)) : [p]; });
const files = walk(join(root, 'js')).filter(f => f.endsWith('.js') && !f.endsWith('theme-init.js'));
let failed = 0;

const exportsOf = new Map();
const namedExports = (file) => {
  if (exportsOf.has(file)) return exportsOf.get(file);
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) m[1].split(',').forEach(p => { const n = p.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); });
  exportsOf.set(file, names);
  return names;
};

for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.error(`✗ ${relative(root, f)}\n${r.stderr}`); continue; }
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
    const target = join(dirname(f), m[2]);
    if (!existsSync(target)) { failed++; console.error(`✗ ${relative(root, f)}: missing module ${m[2]}`); continue; }
    const have = namedExports(target);
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0];
      if (name && !have.has(name)) { failed++; console.error(`✗ ${relative(root, f)}: '${name}' is not exported by ${m[2]}`); }
    }
  }
  for (const m of src.matchAll(/import\(`?'?\.\/([^`'$)]+)/g)) {
    const target = join(dirname(f), `./${m[1]}`);
    if (!m[1].includes('${') && !existsSync(target)) { failed++; console.error(`✗ ${relative(root, f)}: dynamic import target missing ${m[1]}`); }
  }
}
console.log(failed ? `\n${failed} problem(s) in ${files.length} files` : `✓ ${files.length} modules parsed, all relative imports resolve`);
process.exit(failed ? 1 : 0);
