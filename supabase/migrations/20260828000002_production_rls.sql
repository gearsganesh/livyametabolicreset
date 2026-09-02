-- LIVYA Metabolic production authorization boundary.
--
-- Supabase Auth identifies the caller. These policies decide which rows the
-- caller may see/change. The browser's local model is never trusted for this.
-- This migration assumes the application tables already exist in the live
-- project and makes their authorization reproducible in source control.

create schema if not exists private;

create or replace function private.livya_is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.metabolic_profiles p
    where p.user_id = (select auth.uid())
      and p.status = 'ACTIVE'
      and p.role in ('ADMIN', 'SUB_ADMIN')
  );
$$;

revoke execute on function private.livya_is_staff() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.livya_is_staff() to authenticated;

-- Profiles: users can only read their own identity/role.
alter table public.metabolic_profiles enable row level security;
grant select on public.metabolic_profiles to authenticated;
drop policy if exists "LIVYA users can read their own profile" on public.metabolic_profiles;
create policy "LIVYA users can read their own profile"
on public.metabolic_profiles for select to authenticated
using ((select auth.uid()) = user_id);

-- Clients: staff can manage the clinic roster; clients can only see their own row.
alter table public.metabolic_clients enable row level security;
revoke all on public.metabolic_clients from anon;
grant select, insert, update, delete on public.metabolic_clients to authenticated;
drop policy if exists "LIVYA staff manage clients" on public.metabolic_clients;
drop policy if exists "LIVYA clients read own client row" on public.metabolic_clients;
create policy "LIVYA staff manage clients" on public.metabolic_clients
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients read own client row" on public.metabolic_clients
for select to authenticated using (client_user_id = (select auth.uid()));

-- Reports and measurements: clients see only their own client-visible reports.
alter table public.metabolic_reports enable row level security;
revoke all on public.metabolic_reports from anon;
grant select, insert, update, delete on public.metabolic_reports to authenticated;
drop policy if exists "LIVYA staff manage reports" on public.metabolic_reports;
drop policy if exists "LIVYA clients read own visible reports" on public.metabolic_reports;
create policy "LIVYA staff manage reports" on public.metabolic_reports
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients read own visible reports" on public.metabolic_reports
for select to authenticated
using (client_visible = true and exists (
  select 1 from public.metabolic_clients c
  where c.id = metabolic_reports.client_id and c.client_user_id = (select auth.uid())
));

alter table public.metabolic_report_measurements enable row level security;
revoke all on public.metabolic_report_measurements from anon;
grant select, insert, update, delete on public.metabolic_report_measurements to authenticated;
drop policy if exists "LIVYA staff manage report measurements" on public.metabolic_report_measurements;
drop policy if exists "LIVYA clients read own report measurements" on public.metabolic_report_measurements;
create policy "LIVYA staff manage report measurements" on public.metabolic_report_measurements
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients read own report measurements" on public.metabolic_report_measurements
for select to authenticated
using (exists (
  select 1 from public.metabolic_reports r
  join public.metabolic_clients c on c.id = r.client_id
  where r.id = metabolic_report_measurements.report_id
    and r.client_visible = true
    and c.client_user_id = (select auth.uid())
));

-- Daily check-ins: clients may write only their own self logs; staff may manage all.
alter table public.metabolic_checkins enable row level security;
revoke all on public.metabolic_checkins from anon;
grant select, insert, update, delete on public.metabolic_checkins to authenticated;
drop policy if exists "LIVYA staff manage checkins" on public.metabolic_checkins;
drop policy if exists "LIVYA clients manage own checkins" on public.metabolic_checkins;
create policy "LIVYA staff manage checkins" on public.metabolic_checkins
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients manage own checkins" on public.metabolic_checkins
for all to authenticated
using (source = 'client' and exists (
  select 1 from public.metabolic_clients c where c.id = metabolic_checkins.client_id and c.client_user_id = (select auth.uid())
))
with check (source = 'client' and exists (
  select 1 from public.metabolic_clients c where c.id = metabolic_checkins.client_id and c.client_user_id = (select auth.uid())
));

alter table public.metabolic_checkin_values enable row level security;
revoke all on public.metabolic_checkin_values from anon;
grant select, insert, update, delete on public.metabolic_checkin_values to authenticated;
drop policy if exists "LIVYA staff manage checkin values" on public.metabolic_checkin_values;
drop policy if exists "LIVYA clients manage own checkin values" on public.metabolic_checkin_values;
create policy "LIVYA staff manage checkin values" on public.metabolic_checkin_values
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients manage own checkin values" on public.metabolic_checkin_values
for all to authenticated
using (exists (
  select 1 from public.metabolic_checkins k
  join public.metabolic_clients c on c.id = k.client_id
  where k.id = metabolic_checkin_values.checkin_id and k.source = 'client' and c.client_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.metabolic_checkins k
  join public.metabolic_clients c on c.id = k.client_id
  where k.id = metabolic_checkin_values.checkin_id and k.source = 'client' and c.client_user_id = (select auth.uid())
));

-- Notes: staff manage all notes; clients read only notes explicitly marked visible.
alter table public.metabolic_notes enable row level security;
revoke all on public.metabolic_notes from anon;
grant select, insert, update, delete on public.metabolic_notes to authenticated;
drop policy if exists "LIVYA staff manage notes" on public.metabolic_notes;
drop policy if exists "LIVYA clients read visible notes" on public.metabolic_notes;
create policy "LIVYA staff manage notes" on public.metabolic_notes
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients read visible notes" on public.metabolic_notes
for select to authenticated
using (client_visible = true and exists (
  select 1 from public.metabolic_clients c where c.id = metabolic_notes.client_id and c.client_user_id = (select auth.uid())
));

-- Programmes and schedules: clients can see only the programme assigned to them.
alter table public.metabolic_programs enable row level security;
revoke all on public.metabolic_programs from anon;
grant select, insert, update, delete on public.metabolic_programs to authenticated;
drop policy if exists "LIVYA staff manage programs" on public.metabolic_programs;
drop policy if exists "LIVYA clients read assigned programs" on public.metabolic_programs;
create policy "LIVYA staff manage programs" on public.metabolic_programs
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients read assigned programs" on public.metabolic_programs
for select to authenticated using (exists (
  select 1 from public.metabolic_client_programs cp
  join public.metabolic_clients c on c.id = cp.client_id
  where cp.program_id = metabolic_programs.id and cp.status = 'ACTIVE' and c.client_user_id = (select auth.uid())
));

alter table public.metabolic_program_schedule enable row level security;
revoke all on public.metabolic_program_schedule from anon;
grant select, insert, update, delete on public.metabolic_program_schedule to authenticated;
drop policy if exists "LIVYA staff manage program schedules" on public.metabolic_program_schedule;
drop policy if exists "LIVYA clients read assigned schedules" on public.metabolic_program_schedule;
create policy "LIVYA staff manage program schedules" on public.metabolic_program_schedule
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients read assigned schedules" on public.metabolic_program_schedule
for select to authenticated using (exists (
  select 1 from public.metabolic_client_programs cp
  join public.metabolic_clients c on c.id = cp.client_id
  where cp.program_id = metabolic_program_schedule.program_id and cp.status = 'ACTIVE' and c.client_user_id = (select auth.uid())
));

alter table public.metabolic_client_programs enable row level security;
revoke all on public.metabolic_client_programs from anon;
grant select, insert, update, delete on public.metabolic_client_programs to authenticated;
drop policy if exists "LIVYA staff manage program assignments" on public.metabolic_client_programs;
drop policy if exists "LIVYA clients read own program assignments" on public.metabolic_client_programs;
create policy "LIVYA staff manage program assignments" on public.metabolic_client_programs
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients read own program assignments" on public.metabolic_client_programs
for select to authenticated using (exists (
  select 1 from public.metabolic_clients c where c.id = metabolic_client_programs.client_id and c.client_user_id = (select auth.uid())
));

-- Diet plans/chart: clients see only their own active plan and entries.
alter table public.metabolic_diet_plans enable row level security;
revoke all on public.metabolic_diet_plans from anon;
grant select, insert, update, delete on public.metabolic_diet_plans to authenticated;
drop policy if exists "LIVYA staff manage diet plans" on public.metabolic_diet_plans;
drop policy if exists "LIVYA clients read own diet plans" on public.metabolic_diet_plans;
create policy "LIVYA staff manage diet plans" on public.metabolic_diet_plans
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients read own diet plans" on public.metabolic_diet_plans
for select to authenticated using (is_active = true and exists (
  select 1 from public.metabolic_clients c where c.id = metabolic_diet_plans.client_id and c.client_user_id = (select auth.uid())
));

alter table public.metabolic_diet_chart_entries enable row level security;
revoke all on public.metabolic_diet_chart_entries from anon;
grant select, insert, update, delete on public.metabolic_diet_chart_entries to authenticated;
drop policy if exists "LIVYA staff manage diet chart" on public.metabolic_diet_chart_entries;
drop policy if exists "LIVYA clients read own diet chart" on public.metabolic_diet_chart_entries;
create policy "LIVYA staff manage diet chart" on public.metabolic_diet_chart_entries
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients read own diet chart" on public.metabolic_diet_chart_entries
for select to authenticated using (exists (
  select 1 from public.metabolic_diet_plans p
  join public.metabolic_clients c on c.id = p.client_id
  where p.id = metabolic_diet_chart_entries.diet_plan_id and p.is_active = true and c.client_user_id = (select auth.uid())
));

-- Recipes: staff manage; clients see only recipes explicitly shared with them.
alter table public.metabolic_recipes enable row level security;
revoke all on public.metabolic_recipes from anon;
grant select, insert, update, delete on public.metabolic_recipes to authenticated;
drop policy if exists "LIVYA staff manage recipes" on public.metabolic_recipes;
drop policy if exists "LIVYA clients read shared recipes" on public.metabolic_recipes;
create policy "LIVYA staff manage recipes" on public.metabolic_recipes
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients read shared recipes" on public.metabolic_recipes
for select to authenticated using (exists (
  select 1 from public.metabolic_recipe_shares s
  join public.metabolic_clients c on c.id = s.client_id
  where s.recipe_id = metabolic_recipes.id
    and c.client_user_id = (select auth.uid())
    and (s.share_all_clients = true or s.client_id = c.id)
));

alter table public.metabolic_recipe_shares enable row level security;
revoke all on public.metabolic_recipe_shares from anon;
grant select, insert, update, delete on public.metabolic_recipe_shares to authenticated;
drop policy if exists "LIVYA staff manage recipe shares" on public.metabolic_recipe_shares;
drop policy if exists "LIVYA clients read own recipe shares" on public.metabolic_recipe_shares;
create policy "LIVYA staff manage recipe shares" on public.metabolic_recipe_shares
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients read own recipe shares" on public.metabolic_recipe_shares
for select to authenticated using (exists (
  select 1 from public.metabolic_clients c where c.id = metabolic_recipe_shares.client_id and c.client_user_id = (select auth.uid())
));

-- Files: staff manage; clients see/download only their own visible files.
alter table public.metabolic_files enable row level security;
revoke all on public.metabolic_files from anon;
grant select, insert, update, delete on public.metabolic_files to authenticated;
drop policy if exists "LIVYA staff manage files" on public.metabolic_files;
drop policy if exists "LIVYA clients read visible files" on public.metabolic_files;
create policy "LIVYA staff manage files" on public.metabolic_files
for all to authenticated using ((select private.livya_is_staff())) with check ((select private.livya_is_staff()));
create policy "LIVYA clients read visible files" on public.metabolic_files
for select to authenticated using (client_visible = true and status = 'ACTIVE' and exists (
  select 1 from public.metabolic_clients c where c.id = metabolic_files.client_id and c.client_user_id = (select auth.uid())
));

-- Audit: authenticated callers may append only as themselves; nobody can update/delete.
alter table public.metabolic_audit_logs enable row level security;
revoke all on public.metabolic_audit_logs from anon;
grant select, insert on public.metabolic_audit_logs to authenticated;
drop policy if exists "LIVYA staff read audit" on public.metabolic_audit_logs;
drop policy if exists "LIVYA callers append own audit" on public.metabolic_audit_logs;
create policy "LIVYA staff read audit" on public.metabolic_audit_logs
for select to authenticated using ((select private.livya_is_staff()));
create policy "LIVYA callers append own audit" on public.metabolic_audit_logs
for insert to authenticated with check (actor_id = (select auth.uid()));

-- Never allow unauthenticated Data API access to the clinical tables.
-- service_role/server secret access is intentionally untouched because it
-- bypasses RLS and is used only by trusted server-side operations.
