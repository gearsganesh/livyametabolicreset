-- LIVYA Metabolic production bootstrap
-- Creates the two known staff profiles for the Auth users already provisioned
-- in the dedicated Supabase project.
--
-- This migration intentionally does not create or alter RLS policies. Those
-- policies must be verified against the live schema before being versioned.

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

-- Verification query for the Supabase SQL editor:
-- select user_id, full_name, role, status, job_title
-- from public.metabolic_profiles
-- where lower(full_name) in ('ganesh', 'v.k.t. raju');
