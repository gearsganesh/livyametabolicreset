/* Public Supabase configuration for the LIVYA Metabolic browser client.
 *
 * The publishable key is intentionally public. Authorization is enforced by
 * Supabase Auth + Postgres RLS. Production uses the direct Supabase origin so
 * Auth is not dependent on a Vercel rewrite. The same-origin proxy remains
 * available as an explicit diagnostic/fallback endpoint.
 */
const SUPABASE_DIRECT_URL = 'https://khtwrprihdkbpllxqlmh.supabase.co';
const SUPABASE_PROXY_URL = `${window.location.origin}/supabase`;

window.LIVYA_SUPABASE_CONFIG = Object.freeze({
  url: SUPABASE_DIRECT_URL,
  directUrl: SUPABASE_DIRECT_URL,
  proxyUrl: SUPABASE_PROXY_URL,
  publishableKey: 'sb_publishable_H0-yQ7PV-Xqohz-nKFWIYA_bGew0c5q',
  apiFunction: 'metabolic-api',
  storageBucket: 'metabolic-files'
});
