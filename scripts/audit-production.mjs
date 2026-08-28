import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const checks = [];
const fail = message => checks.push(`FAIL: ${message}`);
const pass = message => checks.push(`PASS: ${message}`);

const read = async path => existsSync(path) ? readFile(path, 'utf8') : '';

const config = await read('supabase-config.js');
const bridge = await read('supabase-bridge.js');
const storage = await read('supabase-storage.js');
const edge = await read('supabase/functions/metabolic-api/index.ts');
const vercel = await read('vercel.json');
const build = await read('scripts/prepare-vercel.mjs');

for (const [name, text] of [
  ['supabase-config.js', config],
  ['supabase-bridge.js', bridge],
  ['supabase-storage.js', storage],
  ['scripts/prepare-vercel.mjs', build],
]) {
  if (/sb_secret_|service_role/i.test(text)) fail(`${name} contains a secret/service-role key literal`);
  else pass(`${name} contains no secret/service-role key literal`);
}

if (!/sb_publishable_/.test(config)) fail('supabase-config.js has no publishable key configuration');
else pass('browser configuration uses a publishable key');

if (!/supabase-bridge\.js/.test(build) || !/supabase-persistence\.js/.test(build) || !/supabase-storage\.js/.test(build)) {
  fail('Vercel build does not inject every production Supabase adapter');
} else pass('Vercel build injects the production Supabase adapters');

if (!/outputDirectory.*\.vercel\/output\/static/s.test(vercel)) fail('Vercel output directory is not the Build Output API static directory');
else pass('Vercel output directory is configured for static Build Output API deployment');

if (!/SUPABASE_SECRET_KEYS/.test(edge) || !/SUPABASE_PUBLISHABLE_KEYS/.test(edge)) {
  fail('Edge Function does not support current Supabase runtime key dictionaries');
} else pass('Edge Function supports current Supabase runtime key dictionaries');

if (!/getUser\(/.test(edge)) fail('Edge Function does not validate the caller with Supabase Auth getUser');
else pass('Edge Function validates the caller through Supabase Auth');

const obsoleteWorkflow = '.github/workflows/fix-login-copy.yml';
if (existsSync(obsoleteWorkflow)) fail(`obsolete workflow still exists: ${obsoleteWorkflow}`);
else pass('obsolete login cleanup workflow is removed');

const output = checks.join('\n');
console.log(output);
if (checks.some(line => line.startsWith('FAIL:'))) process.exit(1);
