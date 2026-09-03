-- Single query surface for the staff patient dashboard.
-- This intentionally contains only aggregated/latest values; detailed rows remain
-- protected by the existing table RLS policies.
create or replace view public.metabolic_patient_dashboard as
with latest_checkin as (
  select distinct on (c.client_id)
    c.client_id,
    c.checkin_date,
    c.notes as checkin_notes
  from public.metabolic_checkins c
  order by c.client_id, c.checkin_date desc, c.created_at desc
),
latest_report as (
  select distinct on (r.client_id)
    r.client_id,
    r.id as report_id,
    r.report_date,
    r.report_type,
    r.title,
    r.extraction_status,
    r.client_visible
  from public.metabolic_reports r
  order by r.client_id, r.report_date desc, r.created_at desc
),
latest_note as (
  select distinct on (n.client_id)
    n.client_id,
    n.id as note_id,
    n.note_type,
    n.content as latest_note,
    n.client_visible,
    n.created_at as note_created_at
  from public.metabolic_notes n
  order by n.client_id, n.created_at desc
),
active_program as (
  select distinct on (cp.client_id)
    cp.client_id,
    cp.program_id,
    cp.start_date,
    cp.end_date,
    cp.status
  from public.metabolic_client_programs cp
  where upper(coalesce(cp.status,'')) in ('ACTIVE','ENROLLED','IN_PROGRESS')
  order by cp.client_id, cp.start_date desc nulls last, cp.created_at desc
),
active_diet as (
  select distinct on (d.client_id)
    d.client_id,
    d.id as diet_plan_id,
    d.calories_target,
    d.protein_target_g,
    d.effective_from,
    d.effective_to
  from public.metabolic_diet_plans d
  where d.is_active = true
  order by d.client_id, d.effective_from desc nulls last, d.created_at desc
)
select
  mc.id as metabolic_client_id,
  mc.hims_patient_id,
  mc.full_name,
  mc.status as metabolic_status,
  mc.client_user_id,
  mc.health_assistant_id,
  ap.program_id as active_program_id,
  ap.start_date as program_start_date,
  ap.end_date as program_end_date,
  ap.status as program_status,
  ad.diet_plan_id as active_diet_plan_id,
  ad.calories_target,
  ad.protein_target_g,
  ad.effective_from as diet_effective_from,
  ad.effective_to as diet_effective_to,
  lr.report_id as latest_report_id,
  lr.report_date as latest_report_date,
  lr.report_type as latest_report_type,
  lr.title as latest_report_title,
  lr.extraction_status as latest_report_extraction_status,
  lc.checkin_date as latest_checkin_date,
  lc.checkin_notes as latest_checkin_notes,
  ln.note_id as latest_note_id,
  ln.note_type as latest_note_type,
  ln.latest_note,
  ln.note_created_at as latest_note_at
from public.metabolic_clients mc
left join active_program ap on ap.client_id = mc.id
left join active_diet ad on ad.client_id = mc.id
left join latest_report lr on lr.client_id = mc.id
left join latest_checkin lc on lc.client_id = mc.id
left join latest_note ln on ln.client_id = mc.id;

grant select on public.metabolic_patient_dashboard to authenticated;
revoke all on public.metabolic_patient_dashboard from anon;
