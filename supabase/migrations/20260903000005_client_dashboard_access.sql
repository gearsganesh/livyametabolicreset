-- Client-facing dashboard access surface.
-- The existing table RLS remains the final authorization boundary. This view
-- exposes only data that is explicitly marked client-visible or belongs to the
-- authenticated client's own record.
create or replace view public.metabolic_client_dashboard as
select
  d.*
from public.metabolic_patient_dashboard d
where d.client_user_id = auth.uid();

grant select on public.metabolic_client_dashboard to authenticated;
revoke all on public.metabolic_client_dashboard from anon;
