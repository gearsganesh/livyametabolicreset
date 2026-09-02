/* Public Supabase configuration for the LIVYA Metabolic browser client.
 *
 * Metabolic Reset is now a module of the Livya HIMS data platform.
 * HIMS is the master for shared client/staff identity data; metabolic_* tables
 * remain the domain-specific store for programmes, reports, check-ins, diet,
 * recipes, messaging and files.
 */
const SUPABASE_DIRECT_URL = 'https://weqghrrvgunfpsvtrlkw.supabase.co';
const SUPABASE_PROXY_URL = `${window.location.origin}/supabase`;

window.LIVYA_SUPABASE_CONFIG = Object.freeze({
  url: SUPABASE_DIRECT_URL,
  directUrl: SUPABASE_DIRECT_URL,
  proxyUrl: SUPABASE_PROXY_URL,
  publishableKey: 'sb_publishable_DWdn7pbFd3kll2rbDmPkpQ_pH80mxTV',
  apiFunction: 'metabolic-api',
  storageBucket: 'metabolic-files'
});
