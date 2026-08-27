/* Public Supabase configuration for the LIVYA Metabolic browser client.
 * The publishable/anon key is intentionally safe to expose in browser code.
 * Database access is enforced by Supabase Auth + Row Level Security.
 */
window.LIVYA_SUPABASE_CONFIG = Object.freeze({
  url: 'https://weqghrrvgunfpsvtrlkw.supabase.co',
  publishableKey: 'sb_publishable_DWdn7pbFd3kll2rbDmPkpQ_pH80mxTV',
  apiFunction: 'metabolic-api',
  storageBucket: 'metabolic-files'
});
