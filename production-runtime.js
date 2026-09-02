/* LIVYA production runtime adapter.
 * The original Claude UI remains the presentation layer, but production
 * persistence is Supabase Auth/Postgres/Storage. Browser storage is cache only.
 */
(function () {
  'use strict';

  const waitForBackend = async () => {
    for (let i = 0; i < 300; i++) {
      if (window.LIVYA_BACKEND?.client) return window.LIVYA_BACKEND;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('LIVYA backend is not ready');
  };

  const MAP_KEY = 'livya-production-file-map-v1';
  const readMap = () => {
    try { return JSON.parse(localStorage.getItem(MAP_KEY) || '{}'); } catch (_) { return {}; }
  };
  const writeMap = map => {
    try { localStorage.setItem(MAP_KEY, JSON.stringify(map)); } catch (_) {}
  };
  const safeName = name => String(name || 'file').replace(/[^A-Za-z0-9._'(),!*$@=;:+? -]/g, '_').replace(/\s+/g, '_');

  async function remotePut(key, file, clientId) {
    const backend = await waitForBackend();
    if (backend.role === 'client') throw new Error('Clients cannot upload clinical files');
    if (!clientId || !key || !file) throw new Error('File upload is missing required information');

    const path = `clients/${clientId}/${key}-${safeName(file.name)}`;
    const { error } = await backend.client.storage.from(backend.config.storageBucket).upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
      cacheControl: '3600'
    });
    if (error) throw error;

    const map = readMap();
    map[key] = { path, clientId, name: file.name, mime: file.type || 'application/octet-stream', size: file.size || null };
    writeMap(map);
    return true;
  }

  async function remoteGet(file) {
    const backend = await waitForBackend();
    const map = readMap();
    const mapped = map[file?.blobKey];
    const path = file?.storagePath || mapped?.path;
    if (!path) {
      const { data, error } = await backend.client.from('metabolic_files')
        .select('bucket_id,storage_path,file_name,mime_type,status')
        .eq('id', file?.id).eq('status', 'ACTIVE').maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const result = await backend.client.storage.from(data.bucket_id).createSignedUrl(data.storage_path, 600, { download: data.file_name });
      if (result.error) throw result.error;
      const response = await fetch(result.data.signedUrl);
      if (!response.ok) throw new Error(`File download failed (${response.status})`);
      return response.blob();
    }

    const result = await backend.client.storage.from(backend.config.storageBucket).createSignedUrl(path, 600, { download: file?.name || mapped?.name || 'file' });
    if (result.error) throw result.error;
    const response = await fetch(result.data.signedUrl);
    if (!response.ok) throw new Error(`File download failed (${response.status})`);
    return response.blob();
  }

  async function remoteDelete(file) {
    const backend = await waitForBackend();
    if (backend.role !== 'admin') throw new Error('Administrator access required');
    const map = readMap();
    const mapped = map[file?.blobKey];
    let row = null;
    if (file?.id) {
      const result = await backend.client.from('metabolic_files').select('id,bucket_id,storage_path').eq('id', file.id).maybeSingle();
      if (result.error) throw result.error;
      row = result.data;
    }
    const bucket = row?.bucket_id || backend.config.storageBucket;
    const path = row?.storage_path || mapped?.path;
    if (path) {
      const result = await backend.client.storage.from(bucket).remove([path]);
      if (result.error) throw result.error;
    }
    if (file?.id) {
      const result = await backend.client.from('metabolic_files').update({ status: 'DELETED' }).eq('id', file.id);
      if (result.error) throw result.error;
    }
    delete map[file?.blobKey];
    writeMap(map);
    return true;
  }

  window.LIVYA_PRODUCTION_FILE_PUT = remotePut;
  window.LIVYA_PRODUCTION_FILE_GET = remoteGet;
  window.LIVYA_PRODUCTION_FILE_DEL = remoteDelete;

  // Prevent the original browser-only auth from becoming an alternate entry
  // point. The production bridge owns authentication and the UI is only a view.
  window.LIVYA_PRODUCTION_AUTH = Object.freeze({ provider: 'supabase', browserPasswordStore: false });

  // Replace the prototype IndexedDB file API once the build has exposed it.
  // This keeps old renderer code working while making Supabase Storage the
  // authoritative file store.
  const installFileApi = () => {
    if (!window.LIVYA_FILES) return false;
    window.LIVYA_FILES.put = remotePut;
    window.LIVYA_FILES.get = remoteGet;
    window.LIVYA_FILES.del = remoteDelete;
    window.LIVYA_FILES.has = async key => !!readMap()[key];
    return true;
  };

  const timer = setInterval(() => {
    if (installFileApi()) clearInterval(timer);
  }, 100);
  setTimeout(() => clearInterval(timer), 30000);
})();
