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

try {
  await run(process.execPath, ['scripts/prepare-vercel.mjs']);
  const html = await readFile(path.join(out, 'index.html'), 'utf8');
  const required = [
    'window.LIVYA_PRODUCTION_BUILD = true;', '/supabase-config.js', '/supabase-bridge.js',
    '/supabase-persistence.js', '/supabase-storage.js', '/supabase-messages.js',
    '/production-hardening.js', '/production-runtime.js', '/production-files-persistence.js',
    '/production-message-receipts.js', "const KEY = 'livya-metabolic-production-v1';",
    'window.LIVYA_PRODUCTION_FILE_PUT', 'window.LIVYA_PRODUCTION_FILE_GET', 'window.LIVYA_PRODUCTION_FILE_DEL'
  ];
  const forbidden = [
    'DB = migrate(picked) || seed();', "const KEY = 'livya-metabolic-v2';",
    "fetch('data/patients.json'", "claude.use('artifact')", 'service_role', 'sb_secret_'
  ];
  for (const token of required) if (!html.includes(token)) throw new Error(`Production build missing: ${token}`);
  for (const token of forbidden) if (html.includes(token)) throw new Error(`Prototype/secret configuration leaked into production build: ${token}`);

  const assets = [
    'supabase-config.js','supabase-bridge.js','supabase-persistence.js','supabase-storage.js',
    'supabase-messages.js','production-hardening.js','production-runtime.js',
    'production-files-persistence.js','production-message-receipts.js'
  ];
  for (const file of assets) if (!existsSync(path.join(out, file))) throw new Error(`Production asset missing: ${file}`);

  const config = await readFile(path.join(out, 'supabase-config.js'), 'utf8');
  if (!config.includes('sb_publishable_')) throw new Error('Publishable Supabase key missing from production config');
  if (config.includes('sb_secret_') || config.includes('service_role')) throw new Error('Secret Supabase credential found in browser config');
  if (!config.includes('https://khtwrprihdkbpllxqlmh.supabase.co')) throw new Error('Production config is not pointed at the dedicated Supabase project');

  const bridge = await readFile(path.join(out, 'supabase-bridge.js'), 'utf8');
  for (const token of ['signInWithPassword','metabolic_profiles','addEventListener(\'submit\'']) {
    if (!bridge.includes(token)) throw new Error(`Production Supabase auth bridge missing: ${token}`);
  }
  if (bridge.includes('livya-metabolic-v2')) throw new Error('Legacy local database key leaked into production Supabase bridge');
  if (!bridge.includes('livya-metabolic-production-v1')) throw new Error('Production local database key missing from Supabase bridge');

  const runtime = await readFile(path.join(out, 'production-runtime.js'), 'utf8');
  for (const token of ['Supabase Storage','remotePut','remoteGet','remoteDelete']) {
    if (!runtime.includes(token)) throw new Error(`Production file runtime missing: ${token}`);
  }
  const filePersistence = await readFile(path.join(out, 'production-files-persistence.js'), 'utf8');
  if (!filePersistence.includes("from('metabolic_files')")) throw new Error('Production file metadata persistence missing');
  const receipts = await readFile(path.join(out, 'production-message-receipts.js'), 'utf8');
  if (!receipts.includes("rpc('metabolic_mark_message_read'")) throw new Error('Secure message receipt RPC missing');

  const hardening = await readFile(path.join(out, 'production-hardening.js'), 'utf8');
  if (hardening.includes('livya-metabolic-v2')) throw new Error('Legacy local database key leaked into production hardening');
  if (!hardening.includes('livya-metabolic-production-v1')) throw new Error('Production local database key missing from hardening adapter');

  console.log('Production build verification passed.');
} finally {
  await rm(out, {recursive:true, force:true});
}
