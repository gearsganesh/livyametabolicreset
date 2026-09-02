/* Persist the file metadata created by the legacy renderer.
 * The bytes are uploaded by production-runtime.js to Supabase Storage first;
 * this adapter then records the authoritative storage path in Postgres.
 */
(function () {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isUuid = v => UUID.test(String(v || ''));
  const wait = async () => {
    for (let i = 0; i < 300; i++) {
      if (window.LIVYA_BACKEND?.client && window.LIVYA_BACKEND?.sessionUserId) return window.LIVYA_BACKEND;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('LIVYA backend is not ready');
  };
  const map = () => {
    try { return JSON.parse(localStorage.getItem('livya-production-file-map-v1') || '{}'); } catch (_) { return {}; }
  };

  async function syncFiles(db) {
    const backend = await wait();
    const files = (db?.files || []).filter(f => isUuid(f.id) && isUuid(f.clientId));
    for (const f of files) {
      if (f.status === 'DELETED') continue;
      const remote = map()[f.blobKey];
      const row = {
        id: f.id,
        client_id: f.clientId,
        file_name: f.name || f.fileName || 'file',
        mime_type: f.mime || f.type || remote?.mime || 'application/octet-stream',
        size_bytes: Number.isFinite(Number(f.size)) ? Number(f.size) : (remote?.size || null),
        bucket_id: f.bucket || backend.config.storageBucket,
        storage_path: f.storagePath || remote?.path || null,
        category: f.category || 'DOCUMENT',
        client_visible: f.clientVisible !== false,
        uploaded_by: isUuid(f.uploadedById) ? f.uploadedById : backend.sessionUserId,
        status: 'ACTIVE',
        metadata: f.metadata || {}
      };
      if (!row.storage_path) continue;
      const { error } = await backend.client.from('metabolic_files').upsert(row, { onConflict: 'id' });
      if (error) throw new Error(`Saving file metadata: ${error.message}`);
    }
  }

  async function install() {
    for (let i = 0; i < 300; i++) {
      if (window.LIVYA_BACKEND && typeof window.save === 'function') break;
      await new Promise(r => setTimeout(r, 100));
    }
    if (!window.LIVYA_BACKEND || typeof window.save !== 'function') return;
    const original = window.save;
    if (original.__livyaFilesWrapped) return;
    const wrapped = async function (...args) {
      const result = await original.apply(this, args);
      try { await syncFiles(window.DB); }
      catch (error) {
        console.error('[LIVYA] File metadata persistence failed:', error);
        window.LIVYA_BACKEND.lastPersistError = String(error.message || error);
      }
      return result;
    };
    wrapped.__livyaFilesWrapped = true;
    wrapped.original = original;
    window.save = wrapped;
  }
  install();
})();
