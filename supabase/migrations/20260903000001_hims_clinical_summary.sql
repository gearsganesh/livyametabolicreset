-- HIMS -> Metabolic clinical history bridge
-- Read-only projection: HIMS remains the source of truth for clinical history.
-- Metabolic-specific care data stays in metabolic_* tables.

create or replace view public.metabolic_hims_clinical_history as
select
  p.patient_id as hims_patient_id,
  p.name as patient_name,
  p.gender,
  p.dob,
  p.mobile,
  p.email,
  p.blood_group,
  p.allergies,
  p.emergency_contact,
  p.status
from public.patients p;

grant select on public.metabolic_hims_clinical_history to authenticated;

-- Do not expose the HIMS clinical projection to anonymous users.
revoke all on public.metabolic_hims_clinical_history from anon;
