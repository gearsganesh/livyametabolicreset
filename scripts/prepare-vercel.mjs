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
const hardeningMarker = '<script src="/production-hardening.js"></script>';
const productionMarker = 'window.LIVYA_PRODUCTION_BUILD = true;';
const injection = [
  `<script>${productionMarker}</script>`,
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
  '<script src="/supabase-config.js"></script>',
  marker,
  persistenceMarker,
  storageMarker,
  hardeningMarker
].join('\n');

// The Claude prototype keeps DB as a top-level `let`. Top-level let/const
// bindings are not properties of window, so production adapters cannot inspect
// the live model. `var` preserves runtime behaviour while exposing window.DB.
html = html.replace('let DB = null, CAP = null;', 'var DB = null, CAP = null;');

// Never ship the prototype's seeded people, recipes or demo credentials as
// production data. The live database is the source of truth. A separate local
// key also prevents an older Claude/demo build from leaking records into the
// production UI on the same browser profile.
html = html.replace("const KEY = 'livya-metabolic-v2';", "const KEY = 'livya-metabolic-production-v1';");
html = html.replace('DB = migrate(picked) || seed();', `DB = migrate(picked) || {
    v:3, updated:nowISO(), users:[], clients:[], programs:[], recipes:[], files:[], audit:[]
  };`);
html = html.replace("if(!DB.clients || !DB.clients.length) DB = seed();", "if(!DB.clients) DB.clients = [];");

// The old login implementation remains in the source for compatibility with
// the single-file UI, but the production bridge captures #loginForm submits and
// authenticates only through Supabase Auth. This marker makes that contract
// explicit to runtime diagnostics and CI.
const builtHtml = html.includes(marker)
  ? html
  : html.replace('</head>', `${injection}\n</head>`);

await writeFile(path.join(out, 'index.html'), builtHtml, 'utf8');
await cp(path.join(root, 'supabase-config.js'), path.join(out, 'supabase-config.js'));
await cp(path.join(root, 'supabase-bridge.js'), path.join(out, 'supabase-bridge.js'));
await cp(path.join(root, 'supabase-persistence.js'), path.join(out, 'supabase-persistence.js'));
await cp(path.join(root, 'supabase-storage.js'), path.join(out, 'supabase-storage.js'));
await cp(path.join(root, 'production-hardening.js'), path.join(out, 'production-hardening.js'));

for (const name of ['docs', 'samples']) {
  const source = path.join(root, name);
  if (existsSync(source)) await cp(source, path.join(out, name), { recursive: true });
}

console.log(`LIVYA Metabolic production build ready: ${out}`);
