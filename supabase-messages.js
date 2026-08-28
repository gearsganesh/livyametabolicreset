/* Durable messaging adapter for the legacy UI model. */
(function () {
  'use strict';
  const LOCAL_KEY = 'livya-message-sync-v1';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isUuid = value => UUID.test(String(value || ''));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function roleFor(profileRole) {
    return profileRole === 'ADMIN' ? 'admin' : profileRole === 'SUB_ADMIN' ? 'subadmin' : 'client';
  }
  function localClientForAuth(db, authId) {
    return (db?.clients || []).find(c => c.clientUserId === authId) || null;
  }
  function authIdForLocal(db, id) {
    if (!id) return null;
    if (isUuid(id)) return id;
    const user = (db?.users || []).find(u => u.id === id);
    if (user?.id && isUuid(user.id)) return user.id;
    const client = (db?.clients || []).find(c => c.id === id);
    return client?.clientUserId || null;
  }
  function localIdForAuth(db, id) {
    if (!id) return null;
    const client = (db?.clients || []).find(c => c.clientUserId === id);
    if (client) return client.id;
    const user = (db?.users || []).find(u => u.id === id);
    return user?.id || id;
  }
  function actorName(db, authId, role) {
    const client = (db?.clients || []).find(c => c.clientUserId === authId);
    if (client) return client.name;
    const user = (db?.users || []).find(u => u.id === authId);
    return user?.name || (role === 'client' ? 'Client' : 'Staff');
  }

  async function getMessages(client, db) {
    const backend = window.LIVYA_BACKEND;
    const staff = backend.role !== 'client';
    let q = client.from('metabolic_messages').select('*').order('created_at', {ascending:true});
    if (!staff) {
      const own = localClientForAuth(db, backend.sessionUserId);
      if (!own) return [];
      q = q.eq('client_id', own.id);
    }
    const {data, error} = await q;
    if (error) throw error;
    return data || [];
  }

  function mergeIntoDb(rows, db) {
    if (!db) return;
    const byClient = new Map();
    for (const c of db.clients || []) byClient.set(c.id, c);
    for (const row of rows) {
      const c = byClient.get(row.client_id);
      if (!c) continue;
      c.messages = Array.isArray(c.messages) ? c.messages : [];
      const local = {
        id: row.local_id || row.id,
        at: row.created_at,
        by: localIdForAuth(db, row.sender_id),
        byName: actorName(db, row.sender_id, row.sender_role),
        byRole: roleFor(row.sender_role),
        text: row.body,
        readBy: (row.read_by || []).map(id => localIdForAuth(db, id)).filter(Boolean),
        authId: row.sender_id,
        persistedId: row.id
      };
      const i = c.messages.findIndex(m => m.id === local.id || m.persistedId === row.id || (m.localId && m.localId === row.local_id));
      if (i >= 0) c.messages[i] = {...c.messages[i], ...local}; else c.messages.push(local);
      c.messages.sort((a,b) => String(a.at).localeCompare(String(b.at)));
    }
  }

  async function persistDbMessages(db) {
    const backend = window.LIVYA_BACKEND;
    if (!backend?.client || !db) return;
    const actorId = backend.sessionUserId;
    if (!isUuid(actorId)) return;
    const rows = [];
    for (const c of db.clients || []) {
      if (!isUuid(c.id)) continue;
      for (const m of c.messages || []) {
        if (!m?.text || !String(m.text).trim()) continue;
        const senderId = isUuid(m.authId) ? m.authId : (m.by === actorId ? actorId : authIdForLocal(db, m.by));
        if (!isUuid(senderId)) continue;
        const senderUser = (db.users || []).find(u => u.id === senderId);
        const senderClient = (db.clients || []).find(x => x.clientUserId === senderId);
        const senderRole = senderClient ? 'CLIENT' : senderUser?.role === 'admin' ? 'ADMIN' : 'SUB_ADMIN';
        const localId = String(m.localId || m.id || '');
        const readBy = [...new Set((m.readBy || []).map(id => authIdForLocal(db, id)).filter(isUuid))];
        rows.push({
          id: isUuid(m.persistedId) ? m.persistedId : undefined,
          local_id: localId || null,
          client_id: c.id,
          sender_id: senderId,
          sender_role: senderRole,
          body: String(m.text).trim(),
          read_by: readBy,
          created_at: m.at || new Date().toISOString(),
          metadata: {source:'livya-browser'}
        });
      }
    }
    for (const row of rows) {
      const {id, ...payload} = row;
      const query = row.id ? backend.client.from('metabolic_messages').upsert(row, {onConflict:'id'}) : backend.client.from('metabolic_messages').upsert(payload, {onConflict:'local_id'});
      const {error} = await query;
      if (error) console.error('[LIVYA] Message sync failed:', error);
    }
  }

  async function boot() {
    for (let i = 0; i < 200; i++) {
      if (window.LIVYA_BACKEND?.client && window.DB) break;
      await sleep(100);
    }
    const backend = window.LIVYA_BACKEND;
    if (!backend?.client || !window.DB) return;

    try {
      const rows = await getMessages(backend.client, window.DB);
      mergeIntoDb(rows, window.DB);
      try { localStorage.setItem(LOCAL_KEY, new Date().toISOString()); } catch (_) {}
      if (typeof window.save === 'function' && !window.save.__livyaMessagesWrapped) {
        const originalSave = window.save;
        const wrapped = async function (...args) {
          const result = await originalSave.apply(this, args);
          try { await persistDbMessages(window.DB); } catch (e) { console.error('[LIVYA] Message persistence failed:', e); }
          return result;
        };
        wrapped.__livyaMessagesWrapped = true;
        wrapped.original = originalSave;
        window.save = wrapped;
      }
      if (typeof window.render === 'function') window.render();
    } catch (error) {
      console.error('[LIVYA] Message hydration failed:', error);
    }
  }

  boot();
})();
