/* LIVYA HIMS -> Metabolic session bridge.
 * Session tokens are transferred only through same-origin postMessage.
 * They are never placed in the URL.
 */
(function () {
  'use strict';

  const ORIGIN = window.location.origin;
  const RELOAD_KEY = 'livya-hims-session-handoff-reloaded';

  function reply(type, detail) {
    try {
      window.parent.postMessage({ type, ...(detail || {}) }, ORIGIN);
    } catch (_) {}
  }

  async function waitForBackend() {
    for (let i = 0; i < 100; i += 1) {
      if (window.LIVYA_BACKEND?.client?.auth) return window.LIVYA_BACKEND;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Metabolic authentication client did not initialize.');
  }

  async function acceptSession(session) {
    if (!session?.access_token || !session?.refresh_token) {
      throw new Error('HIMS did not provide a complete Supabase session.');
    }

    const backend = await waitForBackend();
    const result = await backend.client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token
    });
    if (result?.error) throw result.error;

    try {
      localStorage.setItem('livya-metabolic-auth', JSON.stringify(result.data?.session || session));
    } catch (_) {}

    // The embedded app may already be displaying its login screen. Reload once
    // after the session is persisted so the normal INITIAL_SESSION boot path
    // owns the authenticated state. The sessionStorage flag prevents a loop.
    if (sessionStorage.getItem(RELOAD_KEY) !== '1') {
      sessionStorage.setItem(RELOAD_KEY, '1');
      reply('LIVYA_METABOLIC_SESSION_RELOADING', {
        userId: result.data?.user?.id || result.data?.session?.user?.id || session.user?.id || null
      });
      window.location.reload();
      return;
    }

    sessionStorage.removeItem(RELOAD_KEY);
    reply('LIVYA_METABOLIC_SESSION_ACCEPTED', {
      userId: result.data?.user?.id || result.data?.session?.user?.id || session.user?.id || null
    });
    try {
      if (typeof window.render === 'function') window.render();
    } catch (_) {}
  }

  window.addEventListener('message', event => {
    if (event.origin !== ORIGIN || event.source !== window.parent) return;
    if (event.data?.type !== 'LIVYA_HIMS_SESSION') return;
    void acceptSession(event.data.session).catch(error => {
      console.error('[LIVYA] HIMS session handoff failed:', error);
      reply('LIVYA_METABOLIC_SESSION_FAILED', { message: String(error?.message || error) });
    });
  });

  reply('LIVYA_METABOLIC_SESSION_BRIDGE_READY');
})();
