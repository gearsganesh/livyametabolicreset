-- Aggregated HIMS clinical history for the Metabolic patient dashboard.
-- Detailed HIMS rows remain in their source tables. This projection exposes only
-- patient-scoped counts/latest values needed by the dashboard.
create or replace view public.metabolic_hims_clinical_dashboard with (security_invoker = true) as
with v as (
  select patient_no, count(*) as visit_count, max(check_in_at) as latest_visit_at
  from public.visits group by patient_no
),
vi as (
  select patient_no, count(*) as vital_count,
         max(recorded_at) as latest_vitals_at,
         (array_agg(weight order by recorded_at desc nulls last))[1] as latest_weight,
         (array_agg(height order by recorded_at desc nulls last))[1] as latest_height,
         (array_agg(bmi order by recorded_at desc nulls last))[1] as latest_bmi,
         (array_agg(blood_pressure order by recorded_at desc nulls last))[1] as latest_blood_pressure,
         (array_agg(pulse order by recorded_at desc nulls last))[1] as latest_pulse,
         (array_agg(spo2 order by recorded_at desc nulls last))[1] as latest_spo2
  from public.vitals group by patient_no
),
rx as (
  select patient_no, count(*) as prescription_count, max(created_at) as latest_prescription_at
  from public.visit_prescriptions group by patient_no
),
s as (
  select patient_no, count(*) as screening_count, max(created_at) as latest_screening_at
  from public.visit_screenings group by patient_no
),
f as (
  select patient_no, count(*) as file_count, max(uploaded_at) as latest_file_at
  from public.patient_files where coalesce(status,'') <> 'DELETED' group by patient_no
),
d as (
  select patient_no, count(*) as document_count, max(created_at) as latest_document_at
  from public.encounter_documents group by patient_no
)
select mc.id as metabolic_client_id, mc.hims_patient_id,
       coalesce(v.visit_count,0) as visit_count, v.latest_visit_at,
       coalesce(vi.vital_count,0) as vital_count, vi.latest_vitals_at,
       vi.latest_weight, vi.latest_height, vi.latest_bmi, vi.latest_blood_pressure, vi.latest_pulse, vi.latest_spo2,
       coalesce(rx.prescription_count,0) as prescription_count, rx.latest_prescription_at,
       coalesce(s.screening_count,0) as screening_count, s.latest_screening_at,
       coalesce(f.file_count,0) as file_count, f.latest_file_at,
       coalesce(d.document_count,0) as document_count, d.latest_document_at
from public.metabolic_clients mc
left join v on v.patient_no=mc.hims_patient_id
left join vi on vi.patient_no=mc.hims_patient_id
left join rx on rx.patient_no=mc.hims_patient_id
left join s on s.patient_no=mc.hims_patient_id
left join f on f.patient_no=mc.hims_patient_id
left join d on d.patient_no=mc.hims_patient_id;

grant select on public.metabolic_hims_clinical_dashboard to authenticated;
revoke all on public.metabolic_hims_clinical_dashboard from anon;
