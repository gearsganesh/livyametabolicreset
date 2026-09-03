create index if not exists idx_visits_patient_checkin on public.visits(patient_no, check_in_at desc);
create index if not exists idx_vitals_patient_recorded on public.vitals(patient_no, recorded_at desc);
create index if not exists idx_visit_prescriptions_patient_created on public.visit_prescriptions(patient_no, created_at desc);
create index if not exists idx_visit_screenings_patient_created on public.visit_screenings(patient_no, created_at desc);
create index if not exists idx_patient_files_patient_uploaded on public.patient_files(patient_no, uploaded_at desc);
create index if not exists idx_encounter_documents_patient_created on public.encounter_documents(patient_no, created_at desc);
