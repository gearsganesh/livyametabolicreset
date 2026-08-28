/* LIVYA Metabolic production hardening overlay.
 *
 * This file is intentionally small and independent from the legacy single-file
 * UI. It makes the migration bridge safer without turning localStorage into an
 * authorization mechanism.
 */
(function () {
  'use strict';

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isUuid = value => UUID.test(String(value || ''));
  const SYNC_KEY = 'livya-production-sync-v1';

  function readSyncState() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); } catch (_) { return {}; }
  }

  function writeSyncState(value) {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(value)); } catch (_) {}
  }

  function ensureAuditIds(db) {
    if (!Array.isArray(db?.audit)) return [];
    let changed = false;
    for (const event of db.audit) {
      if (!event || !event.action || !event.detail) continue;
      if (!isUuid(event.id)) {
        event.id = crypto.randomUUID();
        changed = true;
      }
    }
    if (changed) {
      try { localStorage.setItem('livya-metabolic-v2', JSON.stringify(db)); } catch (_) {}
    }
    return db.audit.filter(Boolean);
  }

  async function installAuditGuard() {
    for (let i = 0; i < 150; i++) {
      if (window.LIVYA_BACKEND?.persist && window.DB) break;
      await wait(100);
    }

    const backend = window.LIVYA_BACKEND;
    if (!backend?.persist || backend.persist.__livyaHardeningWrapped) return;

    const originalPersist = backend.persist;
    async function guardedPersist(db) {
      if (!db) return originalPersist(db);

      const events = ensureAuditIds(db);
      const state = readSyncState();
      const sent = new Set(Array.isArray(state.auditIds) ? state.auditIds : []);
      const pending = events.filter(event => event?.id && !sent.has(event.id));

      const copy = {...db, audit: pending.slice(0, 20)};
      const ok = await originalPersist(copy);
      if (ok && pending.length) {
        const next = Array.from(new Set([...sent, ...pending.map(event => event.id)])).slice(-1000);
        writeSyncState({...state, auditIds: next});
      }
      return ok;
    }

    guardedPersist.__livyaHardeningWrapped = true;
    guardedPersist.original = originalPersist;
    backend.persist = guardedPersist;
  }

  async function installDeleteGuard() {
    for (let i = 0; i < 150; i++) {
      if (window.LIVYA_BACKEND?.client && typeof window.save === 'function') break;
      await wait(100);
    }

    const backend = window.LIVYA_BACKEND;
    if (!backend?.client || typeof window.save !== 'function') return;
    if (window.save.__livyaDeleteGuardWrapped) return;

    let previous = null;
    try {
      previous = JSON.parse(localStorage.getItem('livya-metabolic-v2') || 'null');
    } catch (_) {}

    const originalSave = window.save;
    async function guardedSave(msg) {
      const before = previous;
      const result = await originalSave(msg);
      const after = window.DB;
      previous = after ? JSON.parse(JSON.stringify(after)) : previous;

      if (!before || !after) return result;
      const client = backend.client;

      // Clinical records are deliberately not hard-deleted by this generic
      // migration hook. These require explicit domain actions and confirmed
      // RLS semantics. Library objects with an existing status=DELETED field
      // can safely be soft-deleted here.
      const beforeRecipes = new Set((before.recipes || []).map(x => x.id).filter(isUuid));
      const afterRecipes = new Set((after.recipes || []).map(x => x.id).filter(isUuid));
      const deletedRecipes = [...beforeRecipes].filter(id => !afterRecipes.has(id));
      for (const id of deletedRecipes) {
        const { error } = await client.from('metabolic_recipes').update({status: 'DELETED'}).eq('id', id);
        if (error) console.error('[LIVYA] Recipe delete sync failed:', error);
      }

      const beforeFiles = new Set((before.files || []).map(x => x.id).filter(isUuid));
      const afterFiles = new Set((after.files || []).map(x => x.id).filter(isUuid));
      const deletedFiles = [...beforeFiles].filter(id => !afterFiles.has(id));
      for (const id of deletedFiles) {
        const { error } = await client.from('metabolic_files').update({status: 'DELETED'}).eq('id', id);
        if (error) console.error('[LIVYA] File delete sync failed:', error);
      }
    }

    guardedSave.__livyaDeleteGuardWrapped = true;
    guardedSave.original = originalSave;
    window.save = guardedSave;
  }

  function installAuthDiagnostics() {
    const backend = window.LIVYA_BACKEND;
    if (!backend?.client) return;

    backend.client.auth.onAuthStateChange((event, session) => {
      console.info('[LIVYA] Auth event:', event, session?.user?.id || 'no-session');
    });

    window.LIVYA_PRODUCTION = {
      version: '2026.08.28.1',
      supabaseUrl: backend.config?.url || '',
      auth: async () => {
        const result = await backend.client.auth.getSession();
        return result?.data?.session || null;
      },
      profile: async () => {
        const session = await window.LIVYA_PRODUCTION.auth();
        if (!session?.user) return null;
        const result = await backend.client
          .from('metabolic_profiles')
          .select('user_id,full_name,role,status,job_title')
          .eq('user_id', session.user.id)
          .maybeSingle();
        return {data: result.data || null, error: result.error || null};
      }
    };
  }

  async function boot() {
    for (let i = 0; i < 150; i++) {
      if (window.LIVYA_BACKEND?.client) break;
      await wait(100);
    }
    installAuthDiagnostics();
    await installAuditGuard();
    await installDeleteGuard();
  }

  boot();
})();
