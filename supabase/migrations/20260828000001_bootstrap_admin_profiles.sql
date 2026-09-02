-- LIVYA Metabolic production bootstrap
-- Creates the two known staff profiles for the Auth users already provisioned
-- in the dedicated Supabase project.
--
-- This migration only establishes the minimum profile read boundary required
-- for login. The remaining application-table RLS policies are deliberately
-- separate and will be versioned after the live schema is verified.

insert into public.metabolic_profiles (
  user_id,
  full_name,
  role,
  status,
  job_title
)
select
  id,
  case lower(email)
    when 'ganesh@curesectors.in' then 'Ganesh'
    when 'vktraju@curesectors.in' then 'V.K.T. Raju'
  end,
  'ADMIN',
  'ACTIVE',
  case lower(email)
    when 'ganesh@curesectors.in' then 'Head of Innovations & Technology'
    when 'vktraju@curesectors.in' then 'Managing Director'
  end
from auth.users
where lower(email) in ('ganesh@curesectors.in', 'vktraju@curesectors.in')
on conflict (user_id) do update set
  role = excluded.role,
  status = excluded.status,
  full_name = excluded.full_name,
  job_title = excluded.job_title;

-- The browser login performs a SELECT on the current user's profile.
-- This policy does not expose other staff/client profiles.
alter table public.metabolic_profiles enable row level security;
grant select on table public.metabolic_profiles to authenticated;
drop policy if exists "LIVYA users can read their own profile" on public.metabolic_profiles;
create policy "LIVYA users can read their own profile"
on public.metabolic_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

-- Verification query for the Supabase SQL editor:
-- select user_id, full_name, role, status, job_title
-- from public.metabolic_profiles
-- where lower(full_name) in ('ganesh', 'v.k.t. raju');
