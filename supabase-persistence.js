/* LIVYA Metabolic Phase 2 persistence bridge.
 *
 * The existing clinical UI still owns its local view model. This adapter makes
 * the existing save() path durable by mirroring the editable clinical records
 * into the already-provisioned Supabase tables. It deliberately does not
 * rewrite the renderer or invent a second UI state model.
 */
(function () {
  'use strict';

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const uuid = () => crypto.randomUUID();
  const isUuid = value => UUID.test(String(value || ''));
  const client = () => window.LIVYA_BACKEND?.client || null;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function call(query, label) {
    const { data, error } = await query;
    if (error) throw new Error(`${label}: ${error.message}`);
    return data;
  }

  function actorId() {
    return window.LIVYA_BACKEND?.sessionUserId || null;
  }

  function ensureId(row, field = 'id') {
    if (!isUuid(row[field])) row[field] = uuid();
    return row[field];
  }

  async function persistClients(db) {
    const rows = (db.clients || []).map(c => ({
      id: ensureId(c),
      record_number: c.mrn || c.recordNumber || null,
      full_name: c.name || '',
      email: c.email || '',
      phone: c.phone || '',
      sex: c.sex || 'M',
      age_years: c.age == null ? null : Number(c.age),
      height_cm: c.height == null ? null : Number(c.height),
      health_assistant_id: isUuid(c.assistantId) ? c.assistantId : null,
      status: c.status || 'ACTIVE',
      notes: typeof c.notes === 'string' ? c.notes : ''
    }));
    if (!rows.length) return;
    await call(client().from('metabolic_clients').upsert(rows, { onConflict: 'id' }), 'Saving clients');
  }

  async function persistReports(db) {
    const reports = [];
    const measurements = [];

    for (const c of (db.clients || [])) {
      if (!isUuid(c.id)) continue;
      for (const v of (c.visits || [])) {
        const reportId = ensureId(v);
        reports.push({
          id: reportId,
          client_id: c.id,
          report_date: v.date,
          report_type: 'METABOLIC',
          source_name: v.source || 'Clinical report',
          title: v.source || 'Metabolic report',
          source_file_id: isUuid(v.sourceFileId) ? v.sourceFileId : null,
          extraction_status: 'REVIEWED',
          reviewed_by: isUuid(v.editedById) ? v.editedById : actorId(),
          reviewed_at: v.editedAt || v.createdAt || new Date().toISOString(),
          client_visible: true,
          notes: v.notes || '',
          raw_extraction: v.rawExtraction || {},
          created_by: isUuid(v.createdById) ? v.createdById : actorId()
        });

        for (const [marker, value] of Object.entries(v.values || {})) {
          if (value == null || !isFinite(Number(value))) continue;
          measurements.push({
            id: uuid(),
            report_id: reportId,
            marker_code: marker,
            value_numeric: Number(value),
            value_text: null,
            unit: window.R?.[marker]?.unit || '',
            raw_value: String(value),
            source_label: v.source || 'Clinical report',
            reference_low: null,
            reference_high: null,
            flag: 'NONE',
            is_plausible: true,
            reviewer_note: '',
            metadata: {}
          });
        }
      }
    }

    if (reports.length) {
      await call(client().from('metabolic_reports').upsert(reports, { onConflict: 'id' }), 'Saving reports');
    }
    if (measurements.length) {
      await call(client().from('metabolic_report_measurements').upsert(measurements, {
        onConflict: 'report_id,marker_code'
      }), 'Saving report measurements');
    }
  }

  async function persistCheckins(db) {
    const checkins = [];
    const values = [];

    for (const c of (db.clients || [])) {
      if (!isUuid(c.id)) continue;
      for (const k of (c.checkins || [])) {
        const checkinId = ensureId(k);
        checkins.push({
          id: checkinId,
          client_id: c.id,
          checkin_date: k.date,
          source: k.self ? 'client' : 'staff',
          notes: k.notes || '',
          created_by: isUuid(k.createdById) ? k.createdById : actorId()
        });
        for (const [metric, value] of Object.entries(k.values || {})) {
          if (value == null || value === '') continue;
          const numeric = Number(value);
          values.push({
            id: uuid(),
            checkin_id: checkinId,
            metric_code: metric,
            value_numeric: isFinite(numeric) ? numeric : null,
            value_text: isFinite(numeric) ? null : String(value),
            unit: window.R?.[metric]?.unit || '',
            metadata: {}
          });
        }
      }
    }

    if (checkins.length) {
      await call(client().from('metabolic_checkins').upsert(checkins, { onConflict: 'id' }), 'Saving check-ins');
    }
    if (values.length) {
      await call(client().from('metabolic_checkin_values').upsert(values, {
        onConflict: 'checkin_id,metric_code'
      }), 'Saving check-in values');
    }
  }

  async function persistNotes(db) {
    const rows = [];
    for (const c of (db.clients || [])) {
      if (!isUuid(c.id)) continue;
      for (const n of (c.notes || [])) {
        rows.push({
          id: ensureId(n),
          client_id: c.id,
          author_id: isUuid(n.authorId) ? n.authorId : actorId(),
          note_type: n.noteType || 'DAILY',
          content: n.text || n.content || '',
          client_visible: n.visible !== false
        });
      }
    }
    if (rows.length) await call(client().from('metabolic_notes').upsert(rows, { onConflict: 'id' }), 'Saving notes');
  }

  function freqParts(freq) {
    const map = {
      daily:[1,'day'], weekly:[1,'week'], fortnightly:[2,'week'], eightweek:[8,'week'],
      monthly:[1,'month'], quarterly:[1,'quarter'], yearly:[1,'year']
    };
    if (map[freq]) return map[freq];
    const m = String(freq || '').match(/^(\d+)(day|week|month|year)$/);
    return m ? [Number(m[1]), m[2]] : [1,'month'];
  }

  async function persistPrograms(db) {
    if (window.LIVYA_BACKEND?.role !== 'admin') return;

    const programs = (db.programs || []).map(g => ({
      id: ensureId(g),
      name: g.name || 'Untitled programme',
      description: g.description || '',
      duration_weeks: Number(g.durationWeeks || 1),
      is_active: g.active !== false,
      created_by: actorId()
    }));
    if (programs.length) {
      await call(client().from('metabolic_programs').upsert(programs, { onConflict: 'id' }), 'Saving programmes');
    }

    for (const g of (db.programs || [])) {
      if (!isUuid(g.id)) continue;
      const schedule = (g.schedule || []).map(s => {
        const [frequency_value, frequency_unit] = freqParts(s.freq);
        return {
          id: ensureId(s),
          program_id: g.id,
          title: s.label || 'Tracking',
          item_type: s.kind === 'log' ? 'CHECKIN' : 'REPORT',
          frequency_value,
          frequency_unit,
          anchor_days: 0,
          required: true,
          sort_order: 0,
          config: {
            markers: Array.isArray(s.markers) ? s.markers : [],
            selfLog: !!s.selfLog,
            note: s.note || ''
          }
        };
      });
      if (schedule.length) {
        await call(client().from('metabolic_program_schedule').upsert(schedule, { onConflict: 'id' }), 'Saving programme schedule');
      }
    }

    // Keep one active assignment per client/programme/start date. Existing
    // rows are updated; a missing row is inserted without inventing an ID.
    const clientIds = (db.clients || []).filter(c => isUuid(c.id)).map(c => c.id);
    if (!clientIds.length) return;
    const existing = await call(client().from('metabolic_client_programs')
      .select('id,client_id,program_id,start_date,status')
      .in('client_id', clientIds), 'Reading programme assignments');

    for (const c of db.clients || []) {
      if (!isUuid(c.id) || !c.programId || !isUuid(c.programId)) continue;
      const start = c.programStart || new Date().toISOString().slice(0,10);
      const row = (existing || []).find(x => x.client_id === c.id && x.program_id === c.programId && x.start_date === start);
      if (row) {
        await call(client().from('metabolic_client_programs').update({ status:'ACTIVE', end_date:null, assigned_by:actorId() }).eq('id', row.id), 'Updating programme assignment');
      } else {
        await call(client().from('metabolic_client_programs').insert({
          client_id:c.id, program_id:c.programId, start_date:start, status:'ACTIVE', assigned_by:actorId()
        }), 'Creating programme assignment');
      }
    }
  }

  async function persistDiets(db) {
    const plans = [];
    for (const c of (db.clients || [])) {
      if (!isUuid(c.id) || !c.diet?.plan) continue;
      const p = c.diet.plan;
      const existing = await call(client().from('metabolic_diet_plans')
        .select('id').eq('client_id', c.id).eq('is_active', true).order('effective_from', {ascending:false}).limit(1), 'Reading diet plan');
      const id = existing?.[0]?.id || uuid();
      const effective = String(p.updatedAt || new Date().toISOString()).slice(0,10);
      plans.push({
        id,
        client_id:c.id,
        calories_target:p.calories == null ? null : Number(p.calories),
        protein_target_g:p.protein == null ? null : Number(p.protein),
        general_guidance:p.notes || '',
        foods_to_favour:String(p.favour || '').split(/\n+/).filter(Boolean),
        foods_to_limit:String(p.limit || '').split(/\n+/).filter(Boolean),
        is_active:true,
        effective_from:effective,
        effective_to:null,
        created_by:actorId()
      });
      c.diet.__supabasePlanId = id;
    }
    if (plans.length) await call(client().from('metabolic_diet_plans').upsert(plans, {onConflict:'id'}), 'Saving diet plans');

    const dayIndex = {sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
    const entries = [];
    for (const c of (db.clients || [])) {
      const planId = c.diet?.__supabasePlanId;
      if (!isUuid(planId)) continue;
      const cells = c.diet?.chart?.cells || {};
      for (const [key, content] of Object.entries(cells)) {
        const [day, meal] = key.split('.');
        if (dayIndex[day] == null || !content) continue;
        entries.push({
          id:uuid(), diet_plan_id:planId, day_of_week:dayIndex[day], meal_slot:meal,
          content:String(content), calories:null, protein_g:null, sort_order:0
        });
      }
    }
    if (entries.length) {
      await call(client().from('metabolic_diet_chart_entries').upsert(entries, {
        onConflict:'diet_plan_id,day_of_week,meal_slot'
      }), 'Saving diet chart');
    }
  }

  async function persistRecipes(db) {
    if (window.LIVYA_BACKEND?.role === 'client') return;
    const recipes = (db.recipes || []).map(r => ({
      id:ensureId(r), title:r.title || 'Recipe', recipe_date:r.date || null, meal:r.meal || 'Anytime',
      preparation_minutes:r.prepMins == null ? null : Number(r.prepMins),
      servings:r.servings == null ? null : Number(r.servings),
      calories:r.calories == null ? null : Number(r.calories),
      protein_g:r.protein == null ? null : Number(r.protein),
      ingredients:r.ingredients || '', method:r.method || '', tip:r.tip || '', video_url:r.video || '',
      status:'ACTIVE', created_by:actorId()
    }));
    if (recipes.length) await call(client().from('metabolic_recipes').upsert(recipes, {onConflict:'id'}), 'Saving recipes');
  }

  async function persistAudit(db) {
    const logs = (db.audit || []).filter(a => a && a.action && a.detail).slice(0, 20);
    if (!logs.length || !actorId()) return;
    const rows = logs.map(a => ({
      actor_id:actorId(), action:a.action, entity_type:a.clientId ? 'client' : 'system',
      entity_id:isUuid(a.clientId) ? a.clientId : null,
      details:{detail:a.detail, role:a.role || null, localId:a.id || null}
    }));
    await call(client().from('metabolic_audit_logs').insert(rows), 'Saving audit log');
  }

  let running = null;
  async function persist(db) {
    if (!client() || !db) return;
    if (running) return running;
    running = (async () => {
      try {
        await persistClients(db);
        await persistReports(db);
        await persistCheckins(db);
        await persistNotes(db);
        await persistPrograms(db);
        await persistDiets(db);
        await persistRecipes(db);
        await persistAudit(db);
        window.LIVYA_BACKEND.lastPersistAt = new Date().toISOString();
        return true;
      } catch (error) {
        console.error('[LIVYA] Supabase persistence failed:', error);
        window.LIVYA_BACKEND.lastPersistError = String(error.message || error);
        return false;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  async function install() {
    for (let i = 0; i < 200; i++) {
      if (window.LIVYA_BACKEND && typeof window.save === 'function') break;
      await sleep(100);
    }
    if (!window.LIVYA_BACKEND || typeof window.save !== 'function') {
      console.error('[LIVYA] Could not install Supabase persistence hook.');
      return;
    }

    const originalSave = window.save;
    if (originalSave.__livyaSupabaseWrapped) return;

    async function wrappedSave(msg) {
      originalSave(msg);
      const db = window.DB;
      if (db) await persist(db);
    }
    wrappedSave.__livyaSupabaseWrapped = true;
    wrappedSave.original = originalSave;
    window.save = wrappedSave;
    window.LIVYA_BACKEND.persist = persist;
    window.LIVYA_BACKEND.role = window.LIVYA_BACKEND.role || null;
    console.info('[LIVYA] Supabase write-through enabled.');
  }

  install();
})();
