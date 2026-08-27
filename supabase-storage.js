/* LIVYA production file/account helpers.
 * Uses the authenticated Supabase client for Storage so existing RLS policies
 * remain authoritative. Privileged client-account creation is routed through
 * the authenticated Edge Function and never exposes a service key.
 */
(function () {
  'use strict';

  const waitForBackend = async () => {
    for (let i = 0; i < 200; i++) {
      if (window.LIVYA_BACKEND?.client) return window.LIVYA_BACKEND;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('LIVYA backend is not ready');
  };

  const safeName = name => String(name || 'file').replace(/[^A-Za-z0-9._'(),!*$@=;:+? -]/g, '_').replace(/\s+/g, '_');
  const uuid = () => crypto.randomUUID();

  async function uploadFile({ clientId, file, category = 'DOCUMENT', clientVisible = true, metadata = {} }) {
    const backend = await waitForBackend();
    if (!clientId || !file) throw new Error('clientId and file are required');
    if (backend.role === 'client') throw new Error('Clients cannot upload clinical files');

    const bucket = 'metabolic-files';
    const fileId = uuid();
    const path = `clients/${clientId}/${fileId}-${safeName(file.name)}`;

    const { error: uploadError } = await backend.client.storage.from(bucket).upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
      cacheControl: '3600'
    });
    if (uploadError) throw uploadError;

    const { data: row, error: rowError } = await backend.client.from('metabolic_files').insert({
      id: fileId,
      client_id: clientId,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size || null,
      bucket_id: bucket,
      storage_path: path,
      category,
      client_visible: clientVisible,
      uploaded_by: backend.sessionUserId,
      status: 'ACTIVE',
      metadata
    }).select('*').single();
    if (rowError) {
      await backend.client.storage.from(bucket).remove([path]).catch(() => {});
      throw rowError;
    }

    return row;
  }

  async function signedDownload(fileId, expiresIn = 600) {
    const backend = await waitForBackend();
    const { data: row, error: rowError } = await backend.client.from('metabolic_files')
      .select('id,bucket_id,storage_path,file_name,status')
      .eq('id', fileId).eq('status', 'ACTIVE').maybeSingle();
    if (rowError) throw rowError;
    if (!row) throw new Error('File not found or not accessible');

    const { data, error } = await backend.client.storage.from(row.bucket_id).createSignedUrl(row.storage_path, expiresIn, { download: row.file_name });
    if (error) throw error;
    return data.signedUrl;
  }

  async function deleteFile(fileId) {
    const backend = await waitForBackend();
    if (backend.role !== 'admin') throw new Error('Administrator access required');
    const { data: row, error: rowError } = await backend.client.from('metabolic_files')
      .select('id,bucket_id,storage_path').eq('id', fileId).maybeSingle();
    if (rowError) throw rowError;
    if (!row) return false;

    const { error: storageError } = await backend.client.storage.from(row.bucket_id).remove([row.storage_path]);
    if (storageError) throw storageError;
    const { error } = await backend.client.from('metabolic_files').update({ status: 'DELETED' }).eq('id', fileId);
    if (error) throw error;
    return true;
  }

  async function createClientAccount({ clientId, email, password }) {
    const backend = await waitForBackend();
    if (backend.role !== 'admin') throw new Error('Administrator access required');
    const { data, error } = await backend.client.functions.invoke('metabolic-api/client-account', {
      method: 'POST',
      body: { clientId, email, password }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function setClientAccountStatus({ userId, status }) {
    const backend = await waitForBackend();
    if (backend.role !== 'admin') throw new Error('Administrator access required');
    const { data, error } = await backend.client.functions.invoke('metabolic-api/client-account', {
      method: 'PATCH',
      body: { userId, status }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }

  window.LIVYA_BACKEND_FILES = {
    uploadFile,
    signedDownload,
    deleteFile,
    createClientAccount,
    setClientAccountStatus
  };
})();
