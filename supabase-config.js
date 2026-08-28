/* Public Supabase configuration for the LIVYA Metabolic browser client.
 * The publishable key is safe to expose in browser code.
 * Database access is enforced by Supabase Auth + Row Level Security.
 *
 * Production uses a same-origin Vercel proxy for Supabase API traffic. This
 * avoids browser/ISP routing failures to *.supabase.co while keeping the
 * publishable key and Supabase Auth model unchanged.
 */
const LIVYA_SUPABASE_ORIGIN =
  ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'https://khtwrprihdkbpllxqlmh.supabase.co'
    : `${window.location.origin}/supabase`;

window.LIVYA_SUPABASE_CONFIG = Object.freeze({
  url: LIVYA_SUPABASE_ORIGIN,
  directUrl: 'https://khtwrprihdkbpllxqlmh.supabase.co',
  publishableKey: 'sb_publishable_H0-yQ7PV-Xqohz-nKFWIYA_bGew0c5q',
  apiFunction: 'metabolic-api',
  storageBucket: 'metabolic-files'
});
