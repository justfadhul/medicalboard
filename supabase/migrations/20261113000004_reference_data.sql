-- Reference data that the system needs in every environment (not case data).
insert into public.settings (key, value, label, to_confirm) values
  ('agenda_cutoff_days', '7', 'Agenda cut-off (days before the sitting)', true),
  ('default_venue', '"Mulago Specialised Women and Neonatal Hospital, Level 2"', 'Default sitting venue', false),
  ('stage_amber_days', '7', 'Days in stage before the counter turns amber', false),
  ('stage_red_days', '14', 'Days in stage before the counter turns red', false),
  ('receipt_overdue_days', '7', 'Days before a pending receipt is overdue', false),
  ('report_due_days', '30', 'Days after return before a treatment report is due', true),
  ('retention_years', '10', 'Retention period for closed cases (years)', true),
  ('retirement_addressee', '"The Head, {employer}"', 'Addressee for non-police retirement letters', true),
  ('opm_addressee', '"The Permanent Secretary, Office of the Prime Minister"', 'Addressee of the OPM funding letter', true),
  ('opm_signatory', '"Minister of Health"', 'Signatory of the OPM funding letter', true),
  ('board_chair', '{"name":"Dr Hellen T. Aanyu","title":"Chairperson"}', 'Board Chairperson', false),
  ('board_secretary', '{"name":"Dr Rony R. Bahatungire","title":"Ag. Commissioner Clinical Services"}', 'Board Secretary', false),
  ('minute_secretary', '{"name":"Dr Namwanje Lydia","title":"Minute Secretary"}', 'Minute Secretary', false),
  ('dghs', '{"name":"Prof. Charles Olaro","title":"DIRECTOR GENERAL HEALTH SERVICES"}', 'Director General Health Services', false),
  ('memo_from', '{"name":"Dr Urizihiwe Irene","thru":"Ag. CHS (CS)"}', 'Cover memo: From / Thru', false),
  ('ai_reading_acknowledged', 'false', 'Ministry approval recorded for an external AI processor', true)
on conflict (key) do nothing;

insert into public.employers (name, cadre, sort) values
  ('Uganda Police Force', 'police', 1), ('Ministry of Education and Sports', 'teachers', 2),
  ('Ministry of Health', 'health', 3), ('Local government', 'lg', 4)
on conflict (name) do nothing;

insert into public.procedures (name, sort) values
  ('Kidney transplant', 1), ('Liver transplant', 2), ('Bone marrow (stem cell) transplant', 3), ('Complex congenital heart surgery', 4),
  ('Heart valve replacement', 5), ('Cochlear implant', 6), ('Advanced radiotherapy', 7), ('Specialised oncology review', 8),
  ('Complex neurosurgery', 9), ('Complex spinal surgery', 10)
on conflict (name) do nothing;

insert into public.countries (name, sort) values
  ('India', 1), ('Kenya', 2), ('South Africa', 3), ('Egypt', 4), ('Turkey', 5), ('United Arab Emirates', 6),
  ('United Kingdom', 7), ('Germany', 8), ('United States', 9)
on conflict (name) do nothing;

insert into public.rules (id, text, applies_to, status, limit_days) values
  ('R-01', 'Employee ID card', 'Retirement', 'confirmed', null),
  ('R-02', 'Letters of sick leave', 'Retirement', 'confirmed', null),
  ('R-03', 'Medical records', 'Retirement', 'confirmed', null),
  ('R-04', 'Recent consultant report', 'Retirement', 'limit_to_set', null),
  ('R-05', 'Applicant is a public servant; which employers are covered', 'Retirement', 'to_confirm', null),
  ('R-06', 'Specialist referral with diagnosis and reason', 'Referral', 'seen_in_past', null),
  ('R-07', 'Treatment unavailable or inadequate in Uganda, and who certifies it', 'Referral', 'to_confirm', null),
  ('R-08', 'Named receiving doctor''s acceptance', 'Referral', 'seen_in_past', null),
  ('R-09', 'Cost estimate', 'Referral', 'seen_in_past', null),
  ('R-10', 'Proof of funding', 'Referral', 'applied_in_practice', null),
  ('R-11', 'Earlier treatment report submitted', 'Referral', 'to_confirm', null),
  ('R-12', 'Transplant donor and recipient documents', 'All transplants', 'confirmed', null)
on conflict (id) do nothing;

insert into public.doc_catalog (key, name, case_type, transplant, rule_id, can_na, sort) values
  ('id_card', 'Employee ID card', 'retirement', false, 'R-01', false, 1),
  ('sick_leave', 'Letters of sick leave', 'retirement', false, 'R-02', false, 2),
  ('medical_records', 'Medical records from treating facilities', 'retirement', false, 'R-03', false, 3),
  ('consultant_report', 'Recent report from a Medical Consultant', 'retirement', false, 'R-04', false, 4),
  ('specialist_referral', 'Specialist referral and medical report', 'referral', false, 'R-06', false, 1),
  ('acceptance', 'Acceptance from the receiving doctor', 'referral', false, 'R-08', false, 2),
  ('cost_estimate', 'Cost estimate from the receiving centre', 'referral', false, 'R-09', false, 3),
  ('funding_proof', 'Proof of funding (commitment letter)', 'referral', false, 'R-10', false, 4),
  ('earlier_report', 'Treatment report from an earlier referral', 'referral', false, 'R-11', true, 5),
  ('donor_report', 'Donor medical report', null, true, 'R-12', false, 11),
  ('donor_details', 'Donor details', null, true, 'R-12', false, 12),
  ('donor_consent', 'Consent form for the donor', null, true, 'R-12', false, 13),
  ('recipient_consent', 'Consent form for the recipient', null, true, 'R-12', false, 14),
  ('donor_affidavit', 'Affidavit for the donor', null, true, 'R-12', false, 15),
  ('recipient_affidavit', 'Affidavit for the recipient', null, true, 'R-12', false, 16)
on conflict (key) do nothing;

do $$ begin perform public.ensure_sittings(12); end $$;
