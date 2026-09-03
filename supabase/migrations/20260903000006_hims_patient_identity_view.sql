-- Canonical patient identity projection used by the Metabolic UI.
-- This avoids copying common identity fields into metabolic_clients.
create or replace view public.metabolic_hims_patient as
select
  p.patient_id,
  p.name,
  p.gender,
  p.dob,
  p.mobile,
  p.email,
  p.address,
  p.blood_group,
  p.allergies,
  p.emergency_contact,
  p.status,
  p.created_at,
  p.updated_at
from public.patients p;

grant select on public.metabolic_hims_patient to authenticated;
revoke all on public.metabolic_hims_patient from anon;
