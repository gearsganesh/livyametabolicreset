-- LIVYA role-based staff authorization.
-- ADMIN = full control, including employee provisioning.
-- SUB_ADMIN = staff account; access is granted by permission keys stored here.
-- CLIENT = client portal only.

create table if not exists public.metabolic_staff_permissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.metabolic_staff_permissions enable row level security;
revoke all on public.metabolic_staff_permissions from anon;
grant select on public.metabolic_staff_permissions to authenticated;

drop policy if exists "LIVYA users read own staff permissions" on public.metabolic_staff_permissions;
create policy "LIVYA users read own staff permissions"
on public.metabolic_staff_permissions for select to authenticated
using ((select auth.uid()) = user_id);

-- ADMIN access is absolute. Staff access is permission-driven.
create or replace function private.livya_has_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.metabolic_profiles p
    left join public.metabolic_staff_permissions sp on sp.user_id = p.user_id
    where p.user_id = (select auth.uid())
      and p.status = 'ACTIVE'
      and (
        p.role = 'ADMIN'
        or (
          p.role = 'SUB_ADMIN'
          and coalesce((sp.permissions ->> permission_key)::boolean, false)
        )
      )
  );
$$;

revoke execute on function private.livya_has_permission(text) from public, anon;
grant execute on function private.livya_has_permission(text) to authenticated;

-- Keep the existing helper compatible with the rest of the application.
create or replace function private.livya_is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.metabolic_profiles p
    where p.user_id = (select auth.uid())
      and p.status = 'ACTIVE'
      and p.role in ('ADMIN', 'SUB_ADMIN')
  );
$$;

-- Existing staff profiles are intentionally not broadened. Admins have full
-- access; new SUB_ADMIN users receive only the permissions chosen by an ADMIN.

-- CLIENTS
alter table public.metabolic_clients enable row level security;
drop policy if exists "LIVYA staff manage clients" on public.metabolic_clients;
drop policy if exists "LIVYA clients read own client row" on public.metabolic_clients;
create policy "LIVYA staff manage clients" on public.metabolic_clients for all to authenticated
using ((select private.livya_has_permission('clients.manage')))
with check ((select private.livya_has_permission('clients.manage')));
create policy "LIVYA staff view clients" on public.metabolic_clients for select to authenticated
using ((select private.livya_has_permission('clients.view')));
create policy "LIVYA clients read own client row" on public.metabolic_clients for select to authenticated
using (client_user_id = (select auth.uid()));

-- REPORTS
alter table public.metabolic_reports enable row level security;
drop policy if exists "LIVYA staff manage reports" on public.metabolic_reports;
drop policy if exists "LIVYA clients read own visible reports" on public.metabolic_reports;
create policy "LIVYA staff manage reports" on public.metabolic_reports for all to authenticated
using ((select private.livya_has_permission('reports.manage')))
with check ((select private.livya_has_permission('reports.manage')));
create policy "LIVYA staff view reports" on public.metabolic_reports for select to authenticated
using ((select private.livya_has_permission('reports.view')));
create policy "LIVYA clients read own visible reports" on public.metabolic_reports for select to authenticated
using (client_visible = true and exists (select 1 from public.metabolic_clients c where c.id = metabolic_reports.client_id and c.client_user_id = (select auth.uid())));

alter table public.metabolic_report_measurements enable row level security;
drop policy if exists "LIVYA staff manage report measurements" on public.metabolic_report_measurements;
drop policy if exists "LIVYA clients read own report measurements" on public.metabolic_report_measurements;
create policy "LIVYA staff manage report measurements" on public.metabolic_report_measurements for all to authenticated
using ((select private.livya_has_permission('reports.manage')))
with check ((select private.livya_has_permission('reports.manage')));
create policy "LIVYA staff view report measurements" on public.metabolic_report_measurements for select to authenticated
using ((select private.livya_has_permission('reports.view')));
create policy "LIVYA clients read own report measurements" on public.metabolic_report_measurements for select to authenticated
using (exists (select 1 from public.metabolic_reports r join public.metabolic_clients c on c.id = r.client_id where r.id = metabolic_report_measurements.report_id and r.client_visible = true and c.client_user_id = (select auth.uid())));

-- CHECK-INS
alter table public.metabolic_checkins enable row level security;
drop policy if exists "LIVYA staff manage checkins" on public.metabolic_checkins;
drop policy if exists "LIVYA clients manage own checkins" on public.metabolic_checkins;
create policy "LIVYA staff manage checkins" on public.metabolic_checkins for all to authenticated
using ((select private.livya_has_permission('checkins.manage')))
with check ((select private.livya_has_permission('checkins.manage')));
create policy "LIVYA staff view checkins" on public.metabolic_checkins for select to authenticated
using ((select private.livya_has_permission('checkins.view')));
create policy "LIVYA clients manage own checkins" on public.metabolic_checkins for all to authenticated
using (source = 'client' and exists (select 1 from public.metabolic_clients c where c.id = metabolic_checkins.client_id and c.client_user_id = (select auth.uid())))
with check (source = 'client' and exists (select 1 from public.metabolic_clients c where c.id = metabolic_checkins.client_id and c.client_user_id = (select auth.uid())));

alter table public.metabolic_checkin_values enable row level security;
drop policy if exists "LIVYA staff manage checkin values" on public.metabolic_checkin_values;
drop policy if exists "LIVYA clients manage own checkin values" on public.metabolic_checkin_values;
create policy "LIVYA staff manage checkin values" on public.metabolic_checkin_values for all to authenticated
using ((select private.livya_has_permission('checkins.manage')))
with check ((select private.livya_has_permission('checkins.manage')));
create policy "LIVYA staff view checkin values" on public.metabolic_checkin_values for select to authenticated
using ((select private.livya_has_permission('checkins.view')));
create policy "LIVYA clients manage own checkin values" on public.metabolic_checkin_values for all to authenticated
using (exists (select 1 from public.metabolic_checkins k join public.metabolic_clients c on c.id = k.client_id where k.id = metabolic_checkin_values.checkin_id and k.source = 'client' and c.client_user_id = (select auth.uid())))
with check (exists (select 1 from public.metabolic_checkins k join public.metabolic_clients c on c.id = k.client_id where k.id = metabolic_checkin_values.checkin_id and k.source = 'client' and c.client_user_id = (select auth.uid())));

-- NOTES
alter table public.metabolic_notes enable row level security;
drop policy if exists "LIVYA staff manage notes" on public.metabolic_notes;
drop policy if exists "LIVYA clients read visible notes" on public.metabolic_notes;
create policy "LIVYA staff manage notes" on public.metabolic_notes for all to authenticated
using ((select private.livya_has_permission('notes.manage')))
with check ((select private.livya_has_permission('notes.manage')));
create policy "LIVYA staff view notes" on public.metabolic_notes for select to authenticated
using ((select private.livya_has_permission('notes.view')));
create policy "LIVYA clients read visible notes" on public.metabolic_notes for select to authenticated
using (client_visible = true and exists (select 1 from public.metabolic_clients c where c.id = metabolic_notes.client_id and c.client_user_id = (select auth.uid())));

-- PROGRAMMES
alter table public.metabolic_programs enable row level security;
drop policy if exists "LIVYA staff manage programs" on public.metabolic_programs;
drop policy if exists "LIVYA clients read assigned programs" on public.metabolic_programs;
create policy "LIVYA staff manage programs" on public.metabolic_programs for all to authenticated
using ((select private.livya_has_permission('programs.manage')))
with check ((select private.livya_has_permission('programs.manage')));
create policy "LIVYA staff view programs" on public.metabolic_programs for select to authenticated
using ((select private.livya_has_permission('programs.view')));
create policy "LIVYA clients read assigned programs" on public.metabolic_programs for select to authenticated
using (exists (select 1 from public.metabolic_client_programs cp join public.metabolic_clients c on c.id = cp.client_id where cp.program_id = metabolic_programs.id and cp.status = 'ACTIVE' and c.client_user_id = (select auth.uid())));

alter table public.metabolic_program_schedule enable row level security;
drop policy if exists "LIVYA staff manage program schedules" on public.metabolic_program_schedule;
drop policy if exists "LIVYA clients read assigned schedules" on public.metabolic_program_schedule;
create policy "LIVYA staff manage program schedules" on public.metabolic_program_schedule for all to authenticated
using ((select private.livya_has_permission('programs.manage')))
with check ((select private.livya_has_permission('programs.manage')));
create policy "LIVYA staff view program schedules" on public.metabolic_program_schedule for select to authenticated
using ((select private.livya_has_permission('programs.view')));
create policy "LIVYA clients read assigned schedules" on public.metabolic_program_schedule for select to authenticated
using (exists (select 1 from public.metabolic_client_programs cp join public.metabolic_clients c on c.id = cp.client_id where cp.program_id = metabolic_program_schedule.program_id and cp.status = 'ACTIVE' and c.client_user_id = (select auth.uid())));

alter table public.metabolic_client_programs enable row level security;
drop policy if exists "LIVYA staff manage program assignments" on public.metabolic_client_programs;
drop policy if exists "LIVYA clients read own program assignments" on public.metabolic_client_programs;
create policy "LIVYA staff manage program assignments" on public.metabolic_client_programs for all to authenticated
using ((select private.livya_has_permission('programs.manage')))
with check ((select private.livya_has_permission('programs.manage')));
create policy "LIVYA staff view program assignments" on public.metabolic_client_programs for select to authenticated
using ((select private.livya_has_permission('programs.view')));
create policy "LIVYA clients read own program assignments" on public.metabolic_client_programs for select to authenticated
using (exists (select 1 from public.metabolic_clients c where c.id = metabolic_client_programs.client_id and c.client_user_id = (select auth.uid())));

-- DIET
alter table public.metabolic_diet_plans enable row level security;
drop policy if exists "LIVYA staff manage diet plans" on public.metabolic_diet_plans;
drop policy if exists "LIVYA clients read own diet plans" on public.metabolic_diet_plans;
create policy "LIVYA staff manage diet plans" on public.metabolic_diet_plans for all to authenticated
using ((select private.livya_has_permission('diet.manage')))
with check ((select private.livya_has_permission('diet.manage')));
create policy "LIVYA staff view diet plans" on public.metabolic_diet_plans for select to authenticated
using ((select private.livya_has_permission('diet.view')));
create policy "LIVYA clients read own diet plans" on public.metabolic_diet_plans for select to authenticated
using (is_active = true and exists (select 1 from public.metabolic_clients c where c.id = metabolic_diet_plans.client_id and c.client_user_id = (select auth.uid())));

alter table public.metabolic_diet_chart_entries enable row level security;
drop policy if exists "LIVYA staff manage diet chart" on public.metabolic_diet_chart_entries;
drop policy if exists "LIVYA clients read own diet chart" on public.metabolic_diet_chart_entries;
create policy "LIVYA staff manage diet chart" on public.metabolic_diet_chart_entries for all to authenticated
using ((select private.livya_has_permission('diet.manage')))
with check ((select private.livya_has_permission('diet.manage')));
create policy "LIVYA staff view diet chart" on public.metabolic_diet_chart_entries for select to authenticated
using ((select private.livya_has_permission('diet.view')));
create policy "LIVYA clients read own diet chart" on public.metabolic_diet_chart_entries for select to authenticated
using (exists (select 1 from public.metabolic_diet_plans p join public.metabolic_clients c on c.id = p.client_id where p.id = metabolic_diet_chart_entries.diet_plan_id and p.is_active = true and c.client_user_id = (select auth.uid())));

-- RECIPES
alter table public.metabolic_recipes enable row level security;
drop policy if exists "LIVYA staff manage recipes" on public.metabolic_recipes;
drop policy if exists "LIVYA clients read shared recipes" on public.metabolic_recipes;
create policy "LIVYA staff manage recipes" on public.metabolic_recipes for all to authenticated
using ((select private.livya_has_permission('recipes.manage')))
with check ((select private.livya_has_permission('recipes.manage')));
create policy "LIVYA staff view recipes" on public.metabolic_recipes for select to authenticated
using ((select private.livya_has_permission('recipes.view')));
create policy "LIVYA clients read shared recipes" on public.metabolic_recipes for select to authenticated
using (exists (select 1 from public.metabolic_recipe_shares s join public.metabolic_clients c on c.id = s.client_id where s.recipe_id = metabolic_recipes.id and c.client_user_id = (select auth.uid()) and (s.share_all_clients = true or s.client_id = c.id)));

alter table public.metabolic_recipe_shares enable row level security;
drop policy if exists "LIVYA staff manage recipe shares" on public.metabolic_recipe_shares;
drop policy if exists "LIVYA clients read own recipe shares" on public.metabolic_recipe_shares;
create policy "LIVYA staff manage recipe shares" on public.metabolic_recipe_shares for all to authenticated
using ((select private.livya_has_permission('recipes.manage')))
with check ((select private.livya_has_permission('recipes.manage')));
create policy "LIVYA staff view recipe shares" on public.metabolic_recipe_shares for select to authenticated
using ((select private.livya_has_permission('recipes.view')));
create policy "LIVYA clients read own recipe shares" on public.metabolic_recipe_shares for select to authenticated
using (exists (select 1 from public.metabolic_clients c where c.id = metabolic_recipe_shares.client_id and c.client_user_id = (select auth.uid())));

-- FILES
alter table public.metabolic_files enable row level security;
drop policy if exists "LIVYA staff manage files" on public.metabolic_files;
drop policy if exists "LIVYA clients read visible files" on public.metabolic_files;
create policy "LIVYA staff manage files" on public.metabolic_files for all to authenticated
using ((select private.livya_has_permission('files.manage')))
with check ((select private.livya_has_permission('files.manage')));
create policy "LIVYA staff view files" on public.metabolic_files for select to authenticated
using ((select private.livya_has_permission('files.view')));
create policy "LIVYA clients read visible files" on public.metabolic_files for select to authenticated
using (client_visible = true and status = 'ACTIVE' and exists (select 1 from public.metabolic_clients c where c.id = metabolic_files.client_id and c.client_user_id = (select auth.uid())));

-- AUDIT
alter table public.metabolic_audit_logs enable row level security;
drop policy if exists "LIVYA staff read audit" on public.metabolic_audit_logs;
create policy "LIVYA staff read audit" on public.metabolic_audit_logs for select to authenticated
using ((select private.livya_has_permission('audit.view')));

-- CONVERSATIONS / MESSAGES are covered by the existing migrations. Their staff
-- policies are replaced here so message access can also be restricted.
alter table public.metabolic_conversations enable row level security;
drop policy if exists "LIVYA staff manage conversations" on public.metabolic_conversations;
drop policy if exists "LIVYA staff view conversations" on public.metabolic_conversations;
create policy "LIVYA staff manage conversations" on public.metabolic_conversations for all to authenticated
using ((select private.livya_has_permission('messages.manage')))
with check ((select private.livya_has_permission('messages.manage')));
create policy "LIVYA staff view conversations" on public.metabolic_conversations for select to authenticated
using ((select private.livya_has_permission('messages.view')));
create policy "LIVYA clients own conversation" on public.metabolic_conversations for select to authenticated
using (exists (select 1 from public.metabolic_clients c where c.id = metabolic_conversations.client_id and c.client_user_id = (select auth.uid())));

alter table public.metabolic_messages enable row level security;
drop policy if exists "LIVYA staff manage messages" on public.metabolic_messages;
drop policy if exists "LIVYA staff read messages" on public.metabolic_messages;
drop policy if exists "LIVYA clients read own messages" on public.metabolic_messages;
drop policy if exists "LIVYA callers send own messages" on public.metabolic_messages;
create policy "LIVYA staff manage messages" on public.metabolic_messages for all to authenticated
using ((select private.livya_has_permission('messages.manage')))
with check ((select private.livya_has_permission('messages.manage')));
create policy "LIVYA staff view messages" on public.metabolic_messages for select to authenticated
using ((select private.livya_has_permission('messages.view')));
create policy "LIVYA clients read own messages" on public.metabolic_messages for select to authenticated
using (exists (select 1 from public.metabolic_clients c where c.id = metabolic_messages.client_id and c.client_user_id = (select auth.uid())));
create policy "LIVYA clients send own messages" on public.metabolic_messages for insert to authenticated
with check (sender_id = (select auth.uid()) and exists (select 1 from public.metabolic_clients c where c.id = metabolic_messages.client_id and c.client_user_id = (select auth.uid())));

-- Safe defaults for the two existing ADMIN accounts. Admins do not need rows,
-- but having an explicit record makes the dashboard easier to inspect.
insert into public.metabolic_staff_permissions(user_id, permissions)
select p.user_id, '{}'::jsonb
from public.metabolic_profiles p
where p.role = 'ADMIN'
on conflict (user_id) do nothing;
