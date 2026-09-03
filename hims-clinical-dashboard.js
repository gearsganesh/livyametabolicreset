/* HIMS clinical history panel for the embedded Metabolic patient dashboard. */
(function(){
  'use strict';
  if (window.__LIVYA_HIMS_CLINICAL_BRIDGE__) return;
  window.__LIVYA_HIMS_CLINICAL_BRIDGE__ = true;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function esc(v){
    return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function date(v){
    if(!v) return '—';
    try { return new Date(v).toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}); } catch(_) { return String(v).slice(0,10); }
  }
  function metric(v, suffix=''){
    return v === null || v === undefined || v === '' ? '—' : esc(v) + suffix;
  }

  async function render(){
    const backend = window.LIVYA_BACKEND;
    const id = window.UI?.clientId;
    if(!backend?.client || !id) return false;
    const root = document.querySelector('#healthSlot');
    if(!root) return false;
    try {
      const {data, error} = await backend.client
        .from('metabolic_hims_clinical_dashboard')
        .select('*')
        .eq('metabolic_client_id', id)
        .maybeSingle();
      if(error || !data) return false;

      let card = document.getElementById('himsClinicalHistoryCard');
      if(!card){
        card = document.createElement('section');
        card.id = 'himsClinicalHistoryCard';
        card.className = 'card pad';
        root.appendChild(card);
      }
      card.innerHTML = `
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div><div class="eyebrow">HIMS clinical history</div><h3 style="margin-top:3px">Linked clinical record</h3></div>
          <span class="pill neutral">HIMS ID ${esc(data.hims_patient_id || '—')}</span>
        </div>
        <div class="tiles" style="margin-top:14px">
          <div class="tile"><div class="lbl"><span class="eyebrow">Visits</span></div><div class="v">${metric(data.visit_count)}</div><div class="ref">Latest ${date(data.latest_visit_at)}</div></div>
          <div class="tile"><div class="lbl"><span class="eyebrow">Vitals</span></div><div class="v">${metric(data.vital_count)}</div><div class="ref">Latest ${date(data.latest_vitals_at)}</div></div>
          <div class="tile"><div class="lbl"><span class="eyebrow">Prescriptions</span></div><div class="v">${metric(data.prescription_count)}</div><div class="ref">Latest ${date(data.latest_prescription_at)}</div></div>
          <div class="tile"><div class="lbl"><span class="eyebrow">Documents</span></div><div class="v">${metric(Number(data.file_count || 0) + Number(data.document_count || 0))}</div><div class="ref">HIMS record files</div></div>
        </div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:14px;gap:10px">
          <div class="chartcard"><div class="eyebrow">Weight</div><div class="num" style="font-size:18px;margin-top:3px">${metric(data.latest_weight)}</div></div>
          <div class="chartcard"><div class="eyebrow">Height</div><div class="num" style="font-size:18px;margin-top:3px">${metric(data.latest_height)}</div></div>
          <div class="chartcard"><div class="eyebrow">BMI</div><div class="num" style="font-size:18px;margin-top:3px">${metric(data.latest_bmi)}</div></div>
          <div class="chartcard"><div class="eyebrow">Blood pressure</div><div class="num" style="font-size:18px;margin-top:3px">${metric(data.latest_blood_pressure)}</div></div>
        </div>
        <p class="tiny muted" style="margin-top:12px">Identity and HIMS clinical history are read from the HIMS master record. Metabolic programme data remains separate.</p>`;
      return true;
    } catch(e) {
      console.warn('[LIVYA] HIMS clinical dashboard bridge failed', e);
      return false;
    }
  }

  async function boot(){
    for(let i=0;i<100;i++){
      if(await render()){
        const root = document.querySelector('#healthSlot');
        if(root && !root.__himsClinicalObserver){
          const observer = new MutationObserver(() => { if(!document.getElementById('himsClinicalHistoryCard')) void render(); });
          observer.observe(root,{childList:true});
          root.__himsClinicalObserver = observer;
        }
        return;
      }
      await wait(200);
    }
  }
  window.LIVYA_HIMS_CLINICAL = {render, boot};
  void boot();
})();
