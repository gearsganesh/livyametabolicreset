-- Patient dashboard performance indexes for the shared HIMS/Metabolic database.
create index if not exists idx_metabolic_reports_client_date
  on public.metabolic_reports(client_id, report_date desc);
create index if not exists idx_metabolic_checkins_client_date
  on public.metabolic_checkins(client_id, checkin_date desc);
create index if not exists idx_metabolic_notes_client_created
  on public.metabolic_notes(client_id, created_at desc);
create index if not exists idx_metabolic_client_programs_client_status
  on public.metabolic_client_programs(client_id, status);
create index if not exists idx_metabolic_diet_plans_client_status
  on public.metabolic_diet_plans(client_id, status);
