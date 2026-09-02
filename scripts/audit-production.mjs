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
const messageMigration = await read('supabase/migrations/20260828000003_messages.sql');
const conversationMigration = await read('supabase/migrations/20260828000007_conversation_rls.sql');

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

if (!/add column if not exists client_id/.test(messageMigration) || !/alter column client_id set not null/.test(messageMigration)) {
  fail('message migration does not safely upgrade the existing legacy schema');
} else pass('message migration upgrades the existing legacy schema in place');

if (!/create policy "LIVYA clients create own conversation"/.test(conversationMigration)) {
  fail('conversation authorization migration is incomplete');
} else pass('conversation authorization boundary is present');

for (const file of [
  'supabase/migrations/20260828000001_bootstrap_admin_profiles.sql',
  'supabase/migrations/20260828000002_production_rls.sql',
  'supabase/migrations/20260828000003_messages.sql',
  'supabase/migrations/20260828000004_recipe_share_policy_fix.sql',
  'supabase/migrations/20260828000005_storage_rls.sql',
  'supabase/migrations/20260828000006_message_read_receipts.sql',
  'supabase/migrations/20260828000007_conversation_rls.sql',
]) {
  if (existsSync(file)) pass(`migration present: ${file}`);
  else fail(`required migration missing: ${file}`);
}

const obsoleteWorkflow = '.github/workflows/fix-login-copy.yml';
if (existsSync(obsoleteWorkflow)) fail(`obsolete workflow still exists: ${obsoleteWorkflow}`);
else pass('obsolete login cleanup workflow is removed');

const output = checks.join('\n');
console.log(output);
if (checks.some(line => line.startsWith('FAIL:'))) process.exit(1);
