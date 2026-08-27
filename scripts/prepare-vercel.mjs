import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel', 'output', 'static');
await mkdir(out, { recursive: true });

// Copy the prototype site as-is, then inject the production backend bootstrap
// into the build artifact. The GitHub source remains easy to diff and review.
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const marker = '<script src="supabase-bridge.js"></script>';
const injection = [
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
  '<script src="/supabase-config.js"></script>',
  marker
].join('\n');

const builtHtml = html.includes(marker)
  ? html
  : html.replace('</head>', `${injection}\n</head>`);

await writeFile(path.join(out, 'index.html'), builtHtml, 'utf8');
await cp(path.join(root, 'supabase-config.js'), path.join(out, 'supabase-config.js'));
await cp(path.join(root, 'supabase-bridge.js'), path.join(out, 'supabase-bridge.js'));

for (const name of ['docs', 'samples']) {
  const source = path.join(root, name);
  if (existsSync(source)) await cp(source, path.join(out, name), { recursive: true });
}

console.log(`LIVYA Metabolic Vercel build ready: ${out}`);
