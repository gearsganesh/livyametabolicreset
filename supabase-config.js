/* Public Supabase configuration for the LIVYA Metabolic browser client.
 * The publishable key is safe to expose in browser code.
 * Database access is enforced by Supabase Auth + Row Level Security.
 */
window.LIVYA_SUPABASE_CONFIG = Object.freeze({
  url: 'https://khtwrprihdkbpllxqlmh.supabase.co',
  publishableKey: 'sb_publishable_H0-yQ7PV-Xqohz-nKFWIYA_bGew0c5q',
  apiFunction: 'metabolic-api',
  storageBucket: 'metabolic-files'
});
