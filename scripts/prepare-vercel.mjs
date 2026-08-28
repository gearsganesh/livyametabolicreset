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
const messagesMarker = '<script src="/supabase-messages.js"></script>';
const hardeningMarker = '<script src="/production-hardening.js"></script>';
const productionMarker = 'window.LIVYA_PRODUCTION_BUILD = true;';
const injection = [
  `<script>${productionMarker}</script>`,
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
  '<script src="/supabase-config.js"></script>',
  marker,
  persistenceMarker,
  storageMarker,
  messagesMarker,
  hardeningMarker
].join('\n');

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
// authenticates only through Supabase Auth.
const builtHtml = html.includes(marker)
  ? html
  : html.replace('</head>', `${injection}\n</head>`);

await writeFile(path.join(out, 'index.html'), builtHtml, 'utf8');
for (const name of [
  'supabase-config.js',
  'supabase-bridge.js',
  'supabase-persistence.js',
  'supabase-storage.js',
  'supabase-messages.js',
  'production-hardening.js'
]) {
  await cp(path.join(root, name), path.join(out, name));
}

for (const name of ['docs', 'samples']) {
  const source = path.join(root, name);
  if (existsSync(source)) await cp(source, path.join(out, name), { recursive: true });
}

console.log(`LIVYA Metabolic production build ready: ${out}`);
