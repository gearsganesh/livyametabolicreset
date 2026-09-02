/* Secure client read receipts. Clients never receive UPDATE permission on the
 * whole message row; read state is changed through a narrowly scoped RPC. */
(function () {
  'use strict';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function boot() {
    for (let i = 0; i < 300; i++) {
      if (window.LIVYA_BACKEND?.client && typeof window.save === 'function' && window.DB) break;
      await sleep(100);
    }
    const backend = window.LIVYA_BACKEND;
    if (!backend?.client || !window.DB || typeof window.save !== 'function' || backend.role !== 'client') return;
    const original = window.save;
    if (original.__livyaReceiptWrapped) return;
    const wrapped = async function (...args) {
      const result = await original.apply(this, args);
      const own = window.DB.clients?.find(c => c.clientUserId === backend.sessionUserId);
      for (const message of own?.messages || []) {
        if (!message.persistedId || !(message.readBy || []).some(id => id === backend.sessionUserId || id === own.id)) continue;
        const { error } = await backend.client.rpc('metabolic_mark_message_read', { message_id: message.persistedId });
        if (error) console.error('[LIVYA] Message read receipt failed:', error);
      }
      return result;
    };
    wrapped.__livyaReceiptWrapped = true;
    wrapped.original = original;
    window.save = wrapped;
  }
  boot();
})();
