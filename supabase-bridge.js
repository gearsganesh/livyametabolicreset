/* LIVYA Metabolic production bridge.
 *
 * Phase 1 deliberately keeps the existing clinical UI/engine intact while
 * replacing prototype authentication and initial data hydration with
 * Supabase. Phase 2 adds a write-through adapter without rewriting the
 * clinical renderer.
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

  const backend = { client, config: cfg, sessionUserId: null, role: null, lastPersistAt: null, lastPersistError: null, persist: null };
  window.LIVYA_BACKEND = backend;
  const DB_KEY = 'livya-metabolic-v2';
  const SESSION_KEY = 'livya-session';

  const json = async (query) => {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  };

  function localDB() {
    try { return JSON.parse(localStorage.getItem(DB_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function saveLocalDB(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function localRole(role) {
    return role === 'ADMIN' ? 'admin' : role === 'SUB_ADMIN' ? 'subadmin' : 'client';
  }

  async function hydrate() {
    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) return null;

    const profile = await json(client.from('metabolic_profiles')
      .select('*').eq('user_id', session.user.id).maybeSingle());
    if (!profile || profile.status !== 'ACTIVE') {
      await client.auth.signOut();
      throw new Error('Your LIVYA Metabolic account is not active. Ask an administrator to enable it.');
    }

    const role = localRole(profile.role);
    backend.sessionUserId = session.user.id;
    backend.role = role;

    let db = localDB() || { v: 3, updated: new Date().toISOString(), users: [], clients: [], programs: [], recipes: [], files: [], audit: [] };
    db.users = Array.isArray(db.users) ? db.users : [];
    db.clients = Array.isArray(db.clients) ? db.clients : [];
    db.programs = Array.isArray(db.programs) ? db.programs : [];
    db.recipes = Array.isArray(db.recipes) ? db.recipes : [];
    db.files = Array.isArray(db.files) ? db.files : [];
    db.audit = Array.isArray(db.audit) ? db.audit : [];

    const email = session.user.email || '';
    const userRecord = {
      id: session.user.id,
      name: profile.full_name,
      email,
      role,
      active: true,
      pwSet: true,
      phone: profile.phone || '',
      jobTitle: profile.job_title || ''
    };
    const ui = db.users.findIndex(x => x.id === userRecord.id);
    if (ui >= 0) db.users[ui] = { ...db.users[ui], ...userRecord };
    else db.users.push(userRecord);

    const staff = role !== 'client';
    let clientsQuery = client.from('metabolic_clients').select('*').order('full_name');
    if (!staff) clientsQuery = clientsQuery.eq('client_user_id', session.user.id);
    const clients = await json(clientsQuery);
    const clientIds = clients.map(c => c.id);

    let reportsQuery = client.from('metabolic_reports')
      .select('*, metabolic_report_measurements(*)').order('report_date');
    if (!staff) reportsQuery = reportsQuery.in('client_id', clientIds.length ? clientIds : ['00000000-0000-0000-0000-000000000000']);
    const reports = await json(reportsQuery);

    let checkinsQuery = client.from('metabolic_checkins')
      .select('*, metabolic_checkin_values(*)').order('checkin_date');
    if (!staff) checkinsQuery = checkinsQuery.in('client_id', clientIds.length ? clientIds : ['00000000-0000-0000-0000-000000000000']);
    const checkins = await json(checkinsQuery);

    let assignmentsQuery = client.from('metabolic_client_programs')
      .select('*').order('start_date');
    if (!staff) assignmentsQuery = assignmentsQuery.in('client_id', clientIds.length ? clientIds : ['00000000-0000-0000-0000-000000000000']);
    const assignments = await json(assignmentsQuery);

    const programs = await json(client.from('metabolic_programs').select('*, metabolic_program_schedule(*)').order('name'));

    let notesQuery = client.from('metabolic_notes').select('*').order('created_at');
    if (!staff) notesQuery = notesQuery.in('client_id', clientIds.length ? clientIds : ['00000000-0000-0000-0000-000000000000']);
    const notes = await json(notesQuery);

    let dietsQuery = client.from('metabolic_diet_plans').select('*, metabolic_diet_chart_entries(*)').eq('is_active', true);
    if (!staff) dietsQuery = dietsQuery.in('client_id', clientIds.length ? clientIds : ['00000000-0000-0000-0000-000000000000']);
    const diets = await json(dietsQuery);

    const recipes = await json(client.from('metabolic_recipes').select('*').eq('status', 'ACTIVE').order('recipe_date', { ascending: false }));
    const shares = await json(client.from('metabolic_recipe_shares').select('*'));

    let filesQuery = client.from('metabolic_files').select('*').neq('status', 'DELETED').order('uploaded_at', { ascending: false });
    if (!staff) filesQuery = filesQuery.in('client_id', clientIds.length ? clientIds : ['00000000-0000-0000-0000-000000000000']);
    const files = await json(filesQuery);

    db.clients = clients.map(c => {
      const old = db.clients.find(x => x.id === c.id) || {};
      const assignment = assignments.filter(a => a.client_id === c.id && a.status === 'ACTIVE').sort((a,b)=>String(b.start_date).localeCompare(String(a.start_date)))[0];
      const diet = diets.find(d => d.client_id === c.id);
      const cReports = reports.filter(r => r.client_id === c.id);
      const cCheckins = checkins.filter(x => x.client_id === c.id);
      const cNotes = notes.filter(x => x.client_id === c.id);
      return {
        ...old,
        id: c.id,
        name: c.full_name,
        email: c.email,
        phone: c.phone,
        sex: c.sex,
        age: c.age_years == null ? old.age : Number(c.age_years),
        height: c.height_cm == null ? old.height : Number(c.height_cm),
        mrn: c.record_number || old.mrn || '',
        assistantId: c.health_assistant_id || null,
        status: c.status,
        clientUserId: c.client_user_id || old.clientUserId || null,
        notes: cNotes.map(n => ({ id:n.id, at:n.created_at, byName:n.author_id || 'Staff', text:n.content, visible:n.client_visible, authorId:n.author_id, noteType:n.note_type })),
        checkins: cCheckins.map(k => ({
          id:k.id, date:k.checkin_date, at:k.created_at, self:k.source === 'client', byName:k.created_by || 'Client', createdById:k.created_by,
          notes:k.notes || '', values:Object.fromEntries((k.metabolic_checkin_values || []).map(v => [v.metric_code, Number(v.value_numeric ?? v.value_text)]))
        })),
        visits: cReports.map(r => ({
          id:r.id, date:r.report_date, source:r.source_name || r.title, sourceFileId:r.source_file_id,
          createdAt:r.created_at, createdBy:r.created_by,
          values:Object.fromEntries((r.metabolic_report_measurements || []).filter(m => m.value_numeric != null).map(m => [m.marker_code, Number(m.value_numeric)]))
        })),
        programId: assignment?.program_id || old.programId || null,
        programStart: assignment?.start_date || old.programStart || null,
        diet: diet ? {
          plan:{ calories:diet.calories_target, protein:diet.protein_target_g, notes:diet.general_guidance,
            favour:(diet.foods_to_favour || []).join('\n'), limit:(diet.foods_to_limit || []).join('\n'),
            updatedAt:diet.updated_at, updatedByName:diet.created_by || null },
          chart:{ times:old.diet?.chart?.times || {}, cells:Object.fromEntries((diet.metabolic_diet_chart_entries || []).map(e => [`${['sun','mon','tue','wed','thu','fri','sat'][e.day_of_week]}.${e.meal_slot}`, e.content])), updatedAt:diet.updated_at, updatedByName:diet.created_by || null },
          history:old.diet?.history || []
        } : (old.diet || { plan:{}, chart:{times:{},cells:{}}, history:[] })
      };
    });

    db.programs = programs.map(p => ({
      id:p.id, name:p.name, description:p.description, durationWeeks:p.duration_weeks, active:p.is_active,
      createdAt:p.created_at, schedule:(p.metabolic_program_schedule || []).map(s => ({
        id:s.id, label:s.title, freq: frequencyKey(s), kind:s.item_type === 'CHECKIN' ? 'log' : 'report',
        markers:Array.isArray(s.config?.markers) ? s.config.markers : [], selfLog:s.item_type === 'CHECKIN', note:s.config?.note || ''
      }))
    }));

    db.recipes = recipes.map(r => ({
      id:r.id, date:r.recipe_date || String(r.created_at).slice(0,10), title:r.title, meal:r.meal,
      prepMins:r.preparation_minutes, servings:r.servings, calories:r.calories, protein:r.protein_g,
      ingredients:r.ingredients, method:r.method, tip:r.tip, video:r.video_url,
      sharedAll:shares.some(s => s.recipe_id === r.id && s.share_all_clients),
      sharedWith:shares.filter(s => s.recipe_id === r.id && s.client_id).map(s => ({ id:s.id, clientId:s.client_id, at:s.shared_at, byName:s.shared_by })),
      deleteRequest:null, at:r.created_at, byName:r.created_by || ''
    }));

    db.files = files.map(f => ({
      id:f.id, clientId:f.client_id, name:f.file_name, fileName:f.file_name, size:f.size_bytes,
      mime:f.mime_type, category:f.category, uploadedAt:f.uploaded_at, uploadedBy:f.uploaded_by,
      clientVisible:f.client_visible, bucket:f.bucket_id, storagePath:f.storage_path, status:f.status
    }));

    db.updated = new Date().toISOString();
    saveLocalDB(db);

    localStorage.setItem(SESSION_KEY, JSON.stringify({ kind: staff ? 'user' : 'client', id: staff ? session.user.id : (clientIds[0] || '') }));
    return { session, profile, role, db };
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

  function backendError(error) {
    const message = String(error?.message || error || 'Unable to sign in');
    if (/invalid login credentials/i.test(message)) return 'Email or password is incorrect.';
    if (/email not confirmed/i.test(message)) return 'Your email has not been confirmed. Ask the administrator to complete account setup.';
    if (/failed to fetch|network/i.test(message)) return 'Unable to reach the authentication service. Please check the connection and try again.';
    return message;
  }

  function showAuthError(form, error) {
    let box = form.parentElement.querySelector('.autherr');
    if (!box) {
      box = document.createElement('div');
      box.className = 'autherr';
      box.setAttribute('role', 'alert');
      form.parentElement.insertBefore(box, form);
    }
    box.textContent = backendError(error);
  }

  async function backendSignIn(form) {
    const email = form.querySelector('#liEmail')?.value?.trim().toLowerCase();
    const password = form.querySelector('#liPw')?.value || '';
    if (!email || !password) {
      showAuthError(form, 'Enter your email address and password.');
      return;
    }

    const button = form.querySelector('#liGo');
    if (button) {
      button.disabled = true;
      button.textContent = 'Signing in…';
    }

    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await hydrate();
      window.location.reload();
    } catch (error) {
      console.error('[LIVYA] Sign-in failed:', error);
      try { await client.auth.signOut(); } catch (_) {}
      showAuthError(form, error);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Sign in';
      }
    }
  }

  function cleanLoginCopy() {
    document.querySelectorAll('.authbody p, .authbody div').forEach((node) => {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^Clinic staff and clients sign in here\./i.test(text) ||
          /^First time here\?/i.test(text) ||
          /^PROTOTYPE\s*[—-]\s*ACCOUNTS IN THIS DEMO$/i.test(text)) {
        node.remove();
      }
    });
  }

  function installLoginInterceptor() {
    document.addEventListener('submit', function (event) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form.id !== 'loginForm') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      backendSignIn(form);
    }, true);
  }

  function installUi() {
    const style = document.createElement('style');
    style.textContent = `
      .demoacc{display:none!important}
      .authbody::after{display:none!important}
      .livya-backend-status{font:10px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--good-ink);margin-left:8px}
    `;
    document.head.appendChild(style);

    cleanLoginCopy();
    const observer = new MutationObserver(() => {
      cleanLoginCopy();
      const mark = document.querySelector('.mark');
      if (mark && !mark.querySelector('.livya-backend-status')) {
        const s = document.createElement('span');
        s.className = 'livya-backend-status';
        s.textContent = 'Connected';
        mark.appendChild(s);
      }
    });
    observer.observe(document.documentElement, { childList:true, subtree:true });
  }

  async function boot() {
    installUi();
    installLoginInterceptor();
    try {
      const { data: { session } } = await client.auth.getSession();
      if (session?.user) {
        await hydrate();
      }
    } catch (error) {
      console.error('[LIVYA] Backend hydration failed:', error);
    }
  }

  boot();
})();
