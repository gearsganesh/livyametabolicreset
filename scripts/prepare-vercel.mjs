import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel', 'output', 'static');
await mkdir(out, { recursive: true });

let html = await readFile(path.join(root, 'index.html'), 'utf8');
const marker = '<script src="supabase-bridge.js"></script>';
const persistenceMarker = '<script src="supabase-persistence.js"></script>';
const storageMarker = '<script src="supabase-storage.js"></script>';
const injection = [
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
  '<script src="/supabase-config.js"></script>',
  marker,
  persistenceMarker,
  storageMarker
].join('\n');

// The prototype keeps DB as a top-level `let`. Top-level let/const bindings are
// intentionally not properties of window, so the small persistence adapter
// cannot inspect the live model. `var` preserves the same runtime semantics
// here while making window.DB available to the adapter.
html = html.replace('let DB = null, CAP = null;', 'var DB = null, CAP = null;');

const builtHtml = html.includes(marker)
  ? html
  : html.replace('</head>', `${injection}\n</head>`);

await writeFile(path.join(out, 'index.html'), builtHtml, 'utf8');
await cp(path.join(root, 'supabase-config.js'), path.join(out, 'supabase-config.js'));
await cp(path.join(root, 'supabase-bridge.js'), path.join(out, 'supabase-bridge.js'));
await cp(path.join(root, 'supabase-persistence.js'), path.join(out, 'supabase-persistence.js'));
await cp(path.join(root, 'supabase-storage.js'), path.join(out, 'supabase-storage.js'));

for (const name of ['docs', 'samples']) {
  const source = path.join(root, name);
  if (existsSync(source)) await cp(source, path.join(out, name), { recursive: true });
}

console.log(`LIVYA Metabolic Vercel build ready: ${out}`);
