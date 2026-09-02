import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel', 'output', 'static');
await mkdir(out, { recursive: true });

let html = await readFile(path.join(root, 'index.html'), 'utf8');
const injection = [
  '<script>window.LIVYA_PRODUCTION_BUILD = true;</script>',
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
  '<script src="/supabase-config.js"></script>',
  '<script src="/supabase-bridge.js"></script>',
  '<script src="/supabase-persistence.js"></script>',
  '<script src="/supabase-storage.js"></script>',
  '<script src="/supabase-messages.js"></script>',
  '<script src="/production-hardening.js"></script>',
  '<script src="/production-runtime.js"></script>',
  '<script src="/production-files-persistence.js"></script>'
].join('\n');

html = html.replace('let DB = null, CAP = null;', 'var DB = null, CAP = null;');
html = html.replace("const KEY = 'livya-metabolic-v2';", "const KEY = 'livya-metabolic-production-v1';");
html = html.replace('DB = migrate(picked) || seed();', `DB = migrate(picked) || {
    v:3, updated:nowISO(), users:[], clients:[], programs:[], recipes:[], files:[], audit:[]
  };`);
html = html.replace("if(!DB.clients || !DB.clients.length) DB = seed();", "if(!DB.clients) DB.clients = [];");

// Expose the legacy file API so the production runtime can replace it with
// Supabase Storage while retaining the existing renderer behaviour.
html = html.replace('const FILES = (() => {', 'window.LIVYA_FILES = (() => {');
html = html.replace(/\bFILES\./g, 'window.LIVYA_FILES.');
html = html.replaceAll('await window.LIVYA_FILES.put(key, file);', 'await window.LIVYA_PRODUCTION_FILE_PUT(key, file, c.id);');
html = html.replaceAll('await window.LIVYA_FILES.get(f.blobKey).catch(()=>null)', 'await window.LIVYA_PRODUCTION_FILE_GET(f).catch(()=>null)');
html = html.replaceAll('await window.LIVYA_FILES.del(f.blobKey).catch(()=>{})', 'await window.LIVYA_PRODUCTION_FILE_DEL(f).catch(()=>{})');

// Disable the old Claude artifact data channel in production.
html = html.replace(/try\{ CAP = await \(window\.claude && claude\.use \? claude\.use\('artifact'\) : null\); \}catch\(e\)\{ CAP = null; \}/g, 'CAP = null;');
html = html.replace(/try\{ const r = await fetch\('data\/patients\.json', \{cache:'no-store'\}\); if\(r\.ok\) cloud = await r\.json\(\); \}catch\(e\)\{\}/g, 'cloud = null;');

html = html.replace(/<script[^>]+src=["'](?:https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2|\/?supabase-config\.js|\/?supabase-bridge\.js|\/?supabase-persistence\.js|\/?supabase-storage\.js|\/?supabase-messages\.js|\/?production-hardening\.js|\/?production-runtime\.js|\/?production-files-persistence\.js)["'][^>]*><\/script>\s*/gi, '');
html = html.replace(/<script>\s*window\.LIVYA_PRODUCTION_BUILD\s*=\s*true;\s*<\/script>\s*/gi, '');
html = html.replace('</head>', `${injection}\n</head>`);

await writeFile(path.join(out, 'index.html'), html, 'utf8');

for (const name of [
  'supabase-config.js', 'supabase-bridge.js', 'supabase-persistence.js',
  'supabase-storage.js', 'supabase-messages.js', 'production-hardening.js',
  'production-runtime.js', 'production-files-persistence.js'
]) {
  const source = path.join(root, name);
  let content = await readFile(source, 'utf8');
  if (name === 'supabase-bridge.js' || name === 'production-hardening.js') {
    content = content.replaceAll('livya-metabolic-v2', 'livya-metabolic-production-v1');
  }
  await writeFile(path.join(out, name), content, 'utf8');
}

for (const name of ['docs', 'samples']) {
  const source = path.join(root, name);
  if (existsSync(source)) await cp(source, path.join(out, name), { recursive: true });
}

console.log(`LIVYA Metabolic production build ready: ${out}`);
