/* LIVYA Metabolic production hardening.
 * The legacy browser model is retained only as a UI compatibility layer. It is
 * never an authorization boundary. Supabase Auth + RLS are authoritative.
 */
(function () {
  'use strict';

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isUuid = value => UUID.test(String(value || ''));
  const SYNC_KEY = 'livya-production-sync-v2';
  const SESSION_KEY = 'livya-session';

  const clearLegacySession = () => {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  };

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
      if (!isUuid(event.id)) { event.id = crypto.randomUUID(); changed = true; }
    }
    if (changed) {
      try { localStorage.setItem('livya-metabolic-v2', JSON.stringify(db)); } catch (_) {}
    }
    return db.audit.filter(Boolean);
  }

  async function installAuthGuard() {
    const backend = window.LIVYA_BACKEND;
    if (!backend?.client) return;

    try {
      const { data, error } = await backend.client.auth.getSession();
      if (error || !data?.session?.user) {
        clearLegacySession();
        return;
      }

      const userId = data.session.user.id;
      const { data: profile, error: profileError } = await backend.client
        .from('metabolic_profiles')
        .select('user_id,status,role')
        .eq('user_id', userId)
        .maybeSingle();

      if (profileError || !profile || profile.status !== 'ACTIVE') {
        clearLegacySession();
        try { await backend.client.auth.signOut(); } catch (_) {}
      } else {
        backend.sessionUserId = userId;
        backend.role = profile.role === 'ADMIN' ? 'admin' : profile.role === 'SUB_ADMIN' ? 'subadmin' : 'client';
      }
    } catch (error) {
      console.error('[LIVYA] Auth guard failed:', error);
      clearLegacySession();
    }
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
        writeSyncState({...state, auditIds:Array.from(new Set([...sent, ...pending.map(e => e.id)])).slice(-1000)});
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
    if (!backend?.client || typeof window.save !== 'function' || window.save.__livyaDeleteGuardWrapped) return;

    let previous = null;
    try { previous = JSON.parse(localStorage.getItem('livya-metabolic-v2') || 'null'); } catch (_) {}
    const originalSave = window.save;

    async function guardedSave(msg) {
      const before = previous;
      const result = await originalSave(msg);
      const after = window.DB;
      previous = after ? JSON.parse(JSON.stringify(after)) : previous;
      if (!before || !after) return result;

      const client = backend.client;
      const beforeRecipes = new Set((before.recipes || []).map(x => x.id).filter(isUuid));
      const afterRecipes = new Set((after.recipes || []).map(x => x.id).filter(isUuid));
      for (const id of [...beforeRecipes].filter(x => !afterRecipes.has(x))) {
        const { error } = await client.from('metabolic_recipes').update({status:'DELETED'}).eq('id', id);
        if (error) console.error('[LIVYA] Recipe delete sync failed:', error);
      }

      const beforeFiles = new Set((before.files || []).map(x => x.id).filter(isUuid));
      const afterFiles = new Set((after.files || []).map(x => x.id).filter(isUuid));
      for (const id of [...beforeFiles].filter(x => !afterFiles.has(x))) {
        const { error } = await client.from('metabolic_files').update({status:'DELETED'}).eq('id', id);
        if (error) console.error('[LIVYA] File delete sync failed:', error);
      }
      return result;
    }
    guardedSave.__livyaDeleteGuardWrapped = true;
    guardedSave.original = originalSave;
    window.save = guardedSave;
  }

  function installAuthDiagnostics() {
    const backend = window.LIVYA_BACKEND;
    if (!backend?.client) return;
    backend.client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) clearLegacySession();
      console.info('[LIVYA] Auth event:', event, session?.user?.id || 'no-session');
    });

    window.LIVYA_PRODUCTION = {
      version:'2026.08.28.2',
      supabaseUrl:backend.config?.url || '',
      auth:async () => (await backend.client.auth.getSession())?.data?.session || null,
      profile:async () => {
        const session = await window.LIVYA_PRODUCTION.auth();
        if (!session?.user) return null;
        const result = await backend.client.from('metabolic_profiles')
          .select('user_id,full_name,role,status,job_title').eq('user_id',session.user.id).maybeSingle();
        return {data:result.data || null,error:result.error || null};
      }
    };
  }

  async function boot() {
    for (let i = 0; i < 150; i++) {
      if (window.LIVYA_BACKEND?.client) break;
      await wait(100);
    }
    if (!window.LIVYA_BACKEND?.client) { clearLegacySession(); return; }
    await installAuthGuard();
    installAuthDiagnostics();
    await installAuditGuard();
    await installDeleteGuard();
  }

  boot();
})();
