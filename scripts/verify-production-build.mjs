import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel', 'output', 'static');

const run = (cmd, args) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, {cwd:root, stdio:'inherit', shell:false});
  p.on('error', reject);
  p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)));
});

await run(process.execPath, ['scripts/prepare-vercel.mjs']);

const html = await readFile(path.join(out, 'index.html'), 'utf8');
const required = [
  'window.LIVYA_PRODUCTION_BUILD = true;',
  '/supabase-config.js',
  '/supabase-bridge.js',
  '/supabase-persistence.js',
  '/supabase-storage.js',
  '/supabase-messages.js',
  '/production-hardening.js',
  "const KEY = 'livya-metabolic-production-v1';"
];
const forbidden = [
  'DB = migrate(picked) || seed();',
  'const KEY = \'livya-metabolic-v2\';',
  'service_role',
  'sb_secret_'
];

for (const token of required) if (!html.includes(token)) throw new Error(`Production build missing: ${token}`);
for (const token of forbidden) if (html.includes(token)) throw new Error(`Prototype/secret configuration leaked into production build: ${token}`);

const assets = ['supabase-config.js','supabase-bridge.js','supabase-persistence.js','supabase-storage.js','supabase-messages.js','production-hardening.js'];
for (const file of assets) {
  if (!existsSync(path.join(out, file))) throw new Error(`Production asset missing: ${file}`);
}

const config = await readFile(path.join(out, 'supabase-config.js'), 'utf8');
if (!config.includes('sb_publishable_')) throw new Error('Publishable Supabase key missing from production config');
if (config.includes('sb_secret_') || config.includes('service_role')) throw new Error('Secret Supabase credential found in browser config');

const bridge = await readFile(path.join(out, 'supabase-bridge.js'), 'utf8');
for (const token of ['signInWithPassword','metabolic_profiles','addEventListener(\'submit\'']) {
  if (!bridge.includes(token)) throw new Error(`Production Supabase auth bridge missing: ${token}`);
}

console.log('Production build verification passed.');
await rm(out, {recursive:true, force:true});
