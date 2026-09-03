/* LIVYA Metabolic production bridge.
 * Supabase Auth is authoritative for login. The legacy Claude/browser login is
 * never used for authentication, even though the original UI still exists.
 */
(function () {
  'use strict';

  const cfg = window.LIVYA_SUPABASE_CONFIG;
  if (!cfg || !window.supabase?.createClient) {
    console.error('[LIVYA] Supabase client/config unavailable.');
    return;
  }

  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'livya-metabolic-auth'
    }
  });

  const backend = {
    client,
    config: cfg,
    sessionUserId: null,
    role: null,
    lastPersistAt: null,
    lastPersistError: null,
    persist: null,
    hydrate: null
  };
  window.LIVYA_BACKEND = backend;

  const DB_KEY = 'livya-metabolic-v2';
  const SESSION_KEY = 'livya-session';
  const EMPTY_DB = () => ({v:3,updated:new Date().toISOString(),users:[],clients:[],programs:[],recipes:[],files:[],audit:[]});

  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.`)), ms))
  ]);

  async function json(query, label) {
    const result = await withTimeout(query, 10000, label || 'Supabase request');
    if (result.error) throw result.error;
    return result.data;
  }

  function localDB() {
    try { return JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch (_) { return null; }
  }

  function saveLocalDB(db) {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (_) {}
  }

  function localRole(role) {
    return role === 'ADMIN' ? 'admin' : role === 'SUB_ADMIN' ? 'subadmin' : 'client';
  }

  function setLocalSession(kind, id) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({kind, id})); } catch (_) {}
  }

  async function getSession() {
    const r = await withTimeout(client.auth.getSession(), 10000, 'Authentication service');
    return r?.data?.session || null;
  }

  async function getActiveProfile(userId) {
    const profile = await json(
      client.from('metabolic_profiles')
        .select('user_id,full_name,role,status,job_title,phone')
        .eq('user_id', userId)
        .maybeSingle(),
      'Account profile lookup'
    );
    if (!profile) throw new Error('No LIVYA profile is linked to this Supabase account. Ask an administrator to provision the account.');
    if (profile.status !== 'ACTIVE') throw new Error('Your LIVYA Metabolic account is not active. Ask an administrator to enable it.');
    return profile;
  }

  function ensureDb() {
    const db = localDB() || EMPTY_DB();
    for (const key of ['users','clients','programs','recipes','files','audit']) db[key] = Array.isArray(db[key]) ? db[key] : [];
    return db;
  }

  function upsertUser(db, session, profile, role) {
    const rec = {
      id: session.user.id, name: profile.full_name, email: session.user.email || '', role,
      active: true, pwSet: true, phone: profile.phone || '', jobTitle: profile.job_title || ''
    };
    const i = db.users.findIndex(x => x.id === rec.id);
    if (i >= 0) db.users[i] = {...db.users[i], ...rec}; else db.users.push(rec);
  }

  function frequencyKey(s) {
    const n = Number(s.frequency_value || 1);
    const u = String(s.frequency_unit || '').toLowerCase();
    if (u.startsWith('day')) return n === 1 ? 'daily' : `${n}day`;
    if (u.startsWith('week')) return n === 2 ? 'fortnightly' : n === 8 ? 'eightweek' : n === 1 ? 'weekly' : `${n}week`;
    if (u.startsWith('month')) return n === 1 ? 'monthly' : `${n}month`;
    if (u.startsWith('quarter')) return 'quarterly';
    if (u.startsWith('year')) return n === 1 ? 'yearly' : `${n}year`;
    return 'monthly';
  }

  async function hydrate() {
    const session = await getSession();
    if (!session?.user) return null;

    const profile = await getActiveProfile(session.user.id);
    const role = localRole(profile.role);
    backend.sessionUserId = session.user.id;
    backend.role = role;
    setLocalSession(role === 'client' ? 'client' : 'user', session.user.id);

    const db = ensureDb();
    upsertUser(db, session, profile, role);
    const staff = role !== 'client';
    const emptyIds = ['00000000-0000-0000-0000-000000000000'];

    try {
      let q = client.from('metabolic_clients').select('*').order('full_name');
      if (!staff) q = q.eq('client_user_id', session.user.id);
      const clients = await json(q, 'Client records');
      const clientIds = clients.map(c => c.id);

      let rq = client.from('metabolic_reports').select('*, metabolic_report_measurements(*)').order('report_date');
      if (!staff) rq = rq.in('client_id', clientIds.length ? clientIds : emptyIds);
      const reports = await json(rq, 'Reports');

      let cq = client.from('metabolic_checkins').select('*, metabolic_checkin_values(*)').order('checkin_date');
      if (!staff) cq = cq.in('client_id', clientIds.length ? clientIds : emptyIds);
      const checkins = await json(cq, 'Check-ins');

      let aq = client.from('metabolic_client_programs').select('*').order('start_date');
      if (!staff) aq = aq.in('client_id', clientIds.length ? clientIds : emptyIds);
      const assignments = await json(aq, 'Programme assignments');

      const programs = await json(client.from('metabolic_programs').select('*, metabolic_program_schedule(*)').order('name'), 'Programmes');

      let nq = client.from('metabolic_notes').select('*').order('created_at');
      if (!staff) nq = nq.in('client_id', clientIds.length ? clientIds : emptyIds);
      const notes = await json(nq, 'Notes');

      let dq = client.from('metabolic_diet_plans').select('*, metabolic_diet_chart_entries(*)').eq('is_active', true);
      if (!staff) dq = dq.in('client_id', clientIds.length ? clientIds : emptyIds);
      const diets = await json(dq, 'Diet plans');

      let recipes = await json(client.from('metabolic_recipes').select('*').eq('status', 'ACTIVE').order('recipe_date', {ascending:false}), 'Recipes');
      const shares = await json(client.from('metabolic_recipe_shares').select('*'), 'Recipe shares');

      let fq = client.from('metabolic_files').select('*').neq('status', 'DELETED').order('uploaded_at', {ascending:false});
      if (!staff) fq = fq.in('client_id', clientIds.length ? clientIds : emptyIds);
      const files = await json(fq, 'Files');

      db.clients = clients.map(c => {
        const old = db.clients.find(x => x.id === c.id) || {};
        const assignment = assignments.filter(a => a.client_id === c.id && a.status === 'ACTIVE').sort((a,b) => String(b.start_date).localeCompare(String(a.start_date)))[0];
        const diet = diets.find(d => d.client_id === c.id);
        return {
          ...old, id:c.id, name:c.full_name, email:c.email, phone:c.phone, sex:c.sex,
          age:c.age_years == null ? old.age : Number(c.age_years), height:c.height_cm == null ? old.height : Number(c.height_cm),
          mrn:c.record_number || old.mrn || '', assistantId:c.health_assistant_id || null, status:c.status,
          clientUserId:c.client_user_id || old.clientUserId || null,
          notes:notes.filter(n => n.client_id === c.id).map(n => ({id:n.id,at:n.created_at,byName:n.author_id || 'Staff',text:n.content,visible:n.client_visible,authorId:n.author_id,noteType:n.note_type})),
          checkins:checkins.filter(k => k.client_id === c.id).map(k => ({id:k.id,date:k.checkin_date,at:k.created_at,self:k.source === 'client',byName:k.created_by || 'Client',createdById:k.created_by,notes:k.notes || '',values:Object.fromEntries((k.metabolic_checkin_values || []).map(v => [v.metric_code, Number(v.value_numeric ?? v.value_text)]))})),
          visits:reports.filter(r => r.client_id === c.id).map(r => ({id:r.id,date:r.report_date,source:r.source_name || r.title,sourceFileId:r.source_file_id,createdAt:r.created_at,createdBy:r.created_by,values:Object.fromEntries((r.metabolic_report_measurements || []).filter(m => m.value_numeric != null).map(m => [m.marker_code, Number(m.value_numeric)]))})),
          programId:assignment?.program_id || old.programId || null,
          programStart:assignment?.start_date || old.programStart || null,
          diet:diet ? {
            plan:{calories:diet.calories_target,protein:diet.protein_target_g,notes:diet.general_guidance,favour:(diet.foods_to_favour || []).join('\n'),limit:(diet.foods_to_limit || []).join('\n'),updatedAt:diet.updated_at,updatedByName:diet.created_by || null},
            chart:{times:old.diet?.chart?.times || {},cells:Object.fromEntries((diet.metabolic_diet_chart_entries || []).map(e => [`${['sun','mon','tue','wed','thu','fri','sat'][e.day_of_week]}.${e.meal_slot}`,e.content])),updatedAt:diet.updated_at,updatedByName:diet.created_by || null},
            history:old.diet?.history || []
          } : (old.diet || {plan:{},chart:{times:{},cells:{}},history:[]})
        };
      });

      db.programs = programs.map(p => ({id:p.id,name:p.name,description:p.description,durationWeeks:p.duration_weeks,active:p.is_active,createdAt:p.created_at,schedule:(p.metabolic_program_schedule || []).map(s => ({id:s.id,label:s.title,freq:frequencyKey(s),kind:s.item_type === 'CHECKIN' ? 'log' : 'report',markers:Array.isArray(s.config?.markers) ? s.config.markers : [],selfLog:s.item_type === 'CHECKIN',note:s.config?.note || ''}))}));

      db.recipes = recipes.map(r => ({id:r.id,date:r.recipe_date || String(r.created_at).slice(0,10),title:r.title,meal:r.meal,prepMins:r.preparation_minutes,servings:r.servings,calories:r.calories,protein:r.protein_g,ingredients:r.ingredients,method:r.method,tip:r.tip,video:r.video_url,sharedAll:shares.some(s => s.recipe_id === r.id && s.share_all_clients),sharedWith:shares.filter(s => s.recipe_id === r.id && s.client_id).map(s => ({id:s.id,clientId:s.client_id,at:s.shared_at,byName:s.shared_by})),deleteRequest:null,at:r.created_at,byName:r.created_by || ''}));
      db.files = files.map(f => ({id:f.id,clientId:f.client_id,name:f.file_name,fileName:f.file_name,size:f.size_bytes,mime:f.mime_type,category:f.category,uploadedAt:f.uploaded_at,uploadedBy:f.uploaded_by,uploadedByName:f.uploaded_by,clientVisible:f.client_visible,bucket:f.bucket_id,storagePath:f.storage_path,status:f.status}));
      db.updated = new Date().toISOString();
      saveLocalDB(db);
      return {session,profile,role,db};
    } catch (error) {
      backend.lastPersistError = String(error?.message || error);
      console.error('[LIVYA] Database hydration failed:', error);
      return {session,profile,role,db,hydrationError:error};
    }
  }

  backend.hydrate = hydrate;

  async function activateAuthenticatedUi() {
    try {
      const result = await hydrate();
      if (!result) return false;
      if (typeof window.showApp === 'function') window.showApp();
      if (typeof window.render === 'function') window.render();
      return true;
    } catch (error) {
      console.error('[LIVYA] Authenticated UI activation failed:', error);
      return false;
    }
  }

  function backendError(error) {
    const e = error || {};
    const message = String(e?.message || e || 'Unable to sign in');
    const status = e?.status || e?.statusCode || '';
    if (/invalid login credentials/i.test(message)) return 'Email or password is incorrect.';
    if (/email not confirmed/i.test(message)) return 'Your email has not been confirmed. Ask the administrator to complete account setup.';
    if (/no LIVYA profile/i.test(message)) return message;
    if (/not active/i.test(message)) return message;
    if (/failed to fetch|network|timed out|fetch/i.test(message)) return `Unable to reach Supabase${status ? ` (HTTP ${status})` : ''}. Please check the connection and try again.`;
    return message;
  }

  function showAuthError(form, error) {
    let box = form.parentElement.querySelector('.autherr');
    if (!box) { box = document.createElement('div'); box.className = 'autherr'; box.setAttribute('role','alert'); form.parentElement.insertBefore(box, form); }
    box.textContent = backendError(error);
  }

  async function backendSignIn(form) {
    const email = form.querySelector('#liEmail')?.value?.trim().toLowerCase();
    const password = form.querySelector('#liPw')?.value || '';
    if (!email || !password) return showAuthError(form, new Error('Enter your email address and password.'));

    const button = form.querySelector('#liGo');
    if (button) { button.disabled = true; button.textContent = 'Signing in…'; }
    try {
      const result = await withTimeout(client.auth.signInWithPassword({email,password}), 15000, 'Supabase sign-in request');
      if (result?.error) throw result.error;
      const session = result?.data?.session;
      if (!session?.user) throw new Error('Supabase did not return a valid session.');
      const profile = await getActiveProfile(session.user.id);
      backend.sessionUserId = session.user.id;
      backend.role = localRole(profile.role);
      setLocalSession(backend.role === 'client' ? 'client' : 'user', session.user.id);
      window.location.reload();
    } catch (error) {
      console.error('[LIVYA] Sign-in failed:', error);
      try { await withTimeout(client.auth.signOut(), 5000, 'Sign-out'); } catch (_) {}
      showAuthError(form, error);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Sign in'; }
    }
  }

  function cleanLoginCopy(root = document) {
    root.querySelectorAll?.('.authbody p, .authbody div, .demorow, .demoacc').forEach(node => {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (node.classList.contains('demorow') || node.classList.contains('demoacc') ||
          /^Clinic staff and clients sign in here\./i.test(text) ||
          /^First time here\?/i.test(text) ||
          /^PROTOTYPE\s*[—-]\s*ACCOUNTS IN THIS DEMO$/i.test(text)) node.remove();
    });
  }

  function installLoginInterceptor() {
    document.addEventListener('submit', event => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form.id !== 'loginForm') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void backendSignIn(form);
    }, true);
  }

  function installUi() {
    const style = document.createElement('style');
    style.textContent = `
      .demoacc,.demorow,.authbody .prototype,.authbody::after{display:none!important}
      .authbody p.sub:empty{display:none!important}
      .livya-backend-status{font:10px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--good-ink);margin-left:8px}
    `;
    document.head.appendChild(style);
    cleanLoginCopy();
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) for (const n of m.addedNodes) if (n.nodeType === 1) cleanLoginCopy(n);
    });
    observer.observe(document.documentElement, {subtree:true,childList:true});
  }

  async function boot() {
    installUi();
    installLoginInterceptor();
    try {
      const session = await getSession();
      if (session?.user) {
        await activateAuthenticatedUi();
      }
    } catch (error) {
      console.error('[LIVYA] Auth bootstrap failed:', error);
    }
  }

  boot();
})();
