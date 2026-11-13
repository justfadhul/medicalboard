-- FICTIONAL demo data only. Never load real case files here.
-- Runs on `supabase db reset` (local) or `psql -f supabase/seed.sql` against a demo project.
do $$
declare
  v_police int := (select id from public.employers where name = 'Uganda Police Force');
  v_edu int := (select id from public.employers where name = 'Ministry of Education and Sports');
  v_moh int := (select id from public.employers where name = 'Ministry of Health');
  v_prev public.sittings; v_id uuid; r record;
  v_cases jsonb := jsonb_build_array(
    jsonb_build_object('no','UMB-26-901','type','retirement','name','Okello Peter (demo)','gender','Male','dob','1971-05-02','emp',v_police,'station','Kira Division Police Station','stage','intake','days',2),
    jsonb_build_object('no','UMB-26-902','type','retirement','name','Nakato Grace (demo)','gender','Female','dob','1968-11-20','emp',v_edu,'station','Mengo Primary School','stage','review','days',9),
    jsonb_build_object('no','UMB-26-903','type','referral','name','Achieng Mary (demo)','gender','Female','dob','1985-02-11','funding','family','procedure','Kidney transplant','country','India',
      'diagnosis','End-stage renal disease','referring','Dr A. Demo, Mulago National Referral Hospital','receiving','Dr R. Example, Example Hospital, Chennai',
      'cost','USD 18,000','costw','eighteen thousand US dollars','duration','six weeks','acc','sister','stage','review','days',3),
    jsonb_build_object('no','UMB-26-904','type','referral','name','Ssemanda John (demo)','gender','Male','dob','1960-07-30','funding','government','procedure','Complex neurosurgery','country','Kenya',
      'diagnosis','Recurrent meningioma','referring','Dr B. Demo, Mulago National Referral Hospital','receiving','Dr K. Sample, Sample Hospital, Nairobi',
      'cost','USD 12,500','costw','twelve thousand five hundred US dollars','duration','four weeks','acc','son','stage','ready','days',5),
    jsonb_build_object('no','UMB-26-905','type','retirement','name','Mugisha Daniel (demo)','gender','Male','dob','1972-03-14','emp',v_moh,'station','Kiruddu Referral Hospital','stage','ready','days',4)
  );
  c jsonb; v_s public.sittings;
begin
  if exists (select 1 from public.cases where case_no = 'UMB-26-901') then return; end if;
  v_s := public.next_open_sitting();
  for c in select * from jsonb_array_elements(v_cases) loop
    insert into public.cases (case_no, type, name, gender, dob, phone, sms_consent, employer_id, station, funding, procedure, country, diagnosis,
      referring_doctor, receiving_doctor, cost_figures, cost_words, duration, accompanying, stage, stage_entered_at, sitting_id, agenda_serial)
    values (c->>'no', (c->>'type')::public.case_type, c->>'name', c->>'gender', (c->>'dob')::date, '0700000000', true, (c->>'emp')::int, c->>'station',
      (c->>'funding')::public.funding_source, c->>'procedure', c->>'country', c->>'diagnosis', c->>'referring', c->>'receiving', c->>'cost', c->>'costw',
      c->>'duration', c->>'acc', (c->>'stage')::public.case_stage, now() - make_interval(days => (c->>'days')::int),
      case when c->>'stage' = 'ready' then v_s.id end,
      case when c->>'stage' = 'ready' then (select coalesce(max(agenda_serial), 0) + 1 from public.cases where sitting_id = v_s.id) end)
    returning id into v_id;
    for r in select * from public.checklist_for((c->>'type')::public.case_type, c->>'procedure', (c->>'emp')::int) loop
      insert into public.case_documents (case_id, catalog_key, name, source, rule_id, can_na, status, reason, sort)
      values (v_id, r.catalog_key, r.name, r.source, r.rule_id, r.can_na,
        case when r.catalog_key = 'earlier_report' then 'not_applicable' when c->>'stage' = 'intake' and r.sort = 4 then 'not_brought' else 'received' end::public.receipt_status,
        case when c->>'stage' = 'intake' and r.sort = 4 and r.catalog_key <> 'earlier_report' then 'To be presented at the next visit' end, r.sort);
    end loop;
    insert into public.case_fields (case_id, key, label, value, document_id, page_no, bbox, confirmed)
    select v_id, 'name', 'Name on documents', c->>'name', d.id, 1, '{"x":0.1,"y":0.12,"w":0.5,"h":0.05}', c->>'stage' = 'ready'
      from public.case_documents d where d.case_id = v_id order by d.sort limit 1;
    insert into public.case_fields (case_id, key, label, value, document_id, page_no, bbox, confirmed)
    select v_id, 'dob', 'Date of birth', c->>'dob', d.id, 1, '{"x":0.1,"y":0.2,"w":0.3,"h":0.05}', c->>'stage' = 'ready'
      from public.case_documents d where d.case_id = v_id order by d.sort limit 1;
    insert into public.audit_log (case_id, actor_label, action, summary) values (v_id, 'Seed', 'case_created', 'Demo case created (fictional data)');
    perform public.refresh_flags(v_id);
  end loop;
end $$;
