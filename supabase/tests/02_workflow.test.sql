-- Workflow tests: a government-funded transplant referral and a police retirement, intake to closed.
\set QUIET on
create or replace function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.logout() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', false); end $$;
create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_label; end if; raise notice 'ok: %', p_label; end $$;
create or replace function pg_temp.expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'ok: % (%)', p_label, sqlerrm; return; end;
  raise exception 'FAIL: % should have been refused', p_label;
end $$;

-- pure helpers
select pg_temp.check(public.second_thursday(2026, 12) = '2026-12-10', 'second Thursday of December 2026');
select pg_temp.check(public.second_thursday(2027, 1) = '2027-01-14', 'second Thursday of January 2027');
select pg_temp.check(public.minute_number('2026-12-10', 3) = 'MB/12/2026/Min04(3)', 'minute number format');
select pg_temp.check(public.age_on('1972-03-14', '2026-11-13') = 54, 'age from date of birth');
select pg_temp.check(public.words_to_number('Forty-five thousand two hundred and fifty US dollars') = 45250, 'cost in words parsed');
select pg_temp.check(public.norm_name('Achieng  Mary') = public.norm_name('mary achieng'), 'name order ignored');

do $$ declare r record; begin
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'reg2@test.local'), ('00000000-0000-0000-0000-0000000000c1', 'sec2@test.local');
  update public.profiles set role = 'registry' where email = 'reg2@test.local';
  update public.profiles set role = 'secretariat' where email = 'sec2@test.local';
end $$;

-- ===== Referral: government funded, kidney transplant =====
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select set_config('t.case', public.create_case('{"type":"referral","name":"Test Patient One","gender":"Female","dob":"1980-01-15","stated_age":"44",
  "phone":"0700111222","sms_consent":true,"funding":"government","procedure":"Kidney transplant","country":"India","diagnosis":"End-stage renal disease",
  "referring_doctor":"Dr A","receiving_doctor":"Dr R. Rao","cost_figures":"USD 20,000","cost_words":"twenty thousand US dollars","duration":"six weeks",
  "accompanying":"Sister","docs":[{"catalog_key":"earlier_report","status":"not_applicable"},{"catalog_key":"donor_details","status":"not_brought","reason":"Coming next week"}]}')::text, false);
select pg_temp.check((select count(*) from public.case_documents where case_id = current_setting('t.case')::uuid) = 11, 'referral transplant checklist has 5 + 6 documents');
select pg_temp.expect_error('select public.send_to_secretariat(current_setting(''t.case'')::uuid)', 'cannot send before scanning');
do $$ declare d record; begin
  for d in select id, case_id from public.case_documents where case_id = current_setting('t.case')::uuid and status = 'received' loop
    perform public.add_page(d.id, d.case_id || '/' || d.id || '/p1.jpg', 1200, 1700, 0.9, '{"ok":true}');
  end loop;
end $$;
select pg_temp.expect_error('select public.add_page((select id from public.case_documents where case_id = current_setting(''t.case'')::uuid limit 1), ''x/y/z.jpg'', 1, 1, 1)', 'page path must match the document');
select public.send_to_secretariat(current_setting('t.case')::uuid);
select pg_temp.check((select stage from public.cases where id = current_setting('t.case')::uuid) = 'review', 'sent to review');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.check((select bool_or(code = 'age_mismatch') from public.flags where case_id = current_setting('t.case')::uuid), 'stated age mismatch flagged');
select pg_temp.check(not public.criteria_met(current_setting('t.case')::uuid), 'criteria not met yet');
-- donor details missing blocks (R-12 confirmed)
select pg_temp.check(not ((select x from jsonb_array_elements(public.case_criteria(current_setting('t.case')::uuid)) x where x->>'key' = 'docs')->>'ok')::boolean, 'missing transplant document blocks');
select public.add_finding(current_setting('t.case')::uuid, null, 'missing_document', 'Letter from the employer', 'Needed to confirm employment', 'block');
select pg_temp.check(exists (select 1 from public.case_documents where case_id = current_setting('t.case')::uuid and name = 'Letter from the employer' and status = 'not_brought'), 'missing-document finding adds to checklist');
select pg_temp.check(exists (select 1 from public.notes where case_id = current_setting('t.case')::uuid and tag_role = 'registry'), 'registry tagged by finding');
select public.upsert_field(current_setting('t.case')::uuid, 'receiving_doctor', 'Receiving doctor (acceptance)', 'Dr S. Menon');
select pg_temp.check(exists (select 1 from public.flags where case_id = current_setting('t.case')::uuid and code = 'doctor_mismatch'), 'receiving doctor mismatch flagged');
select public.upsert_field(current_setting('t.case')::uuid, 'name', 'Name on documents', 'Test Patient One');
select public.return_to_registry(current_setting('t.case')::uuid, 'Bring the donor details and employer letter');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
do $$ declare d record; begin
  for d in select id, case_id from public.case_documents where case_id = current_setting('t.case')::uuid and status = 'not_brought' loop
    perform public.add_page(d.id, d.case_id || '/' || d.id || '/p1.jpg', 1200, 1700, 0.4, '{"ok":false,"issues":["blur"]}', 'Only copy available');
  end loop;
end $$;
select public.send_to_secretariat(current_setting('t.case')::uuid);
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.set_hold(current_setting('t.case')::uuid, true, 'Awaiting funding confirmation');
select pg_temp.expect_error('select public.mark_ready(current_setting(''t.case'')::uuid)', 'held case cannot go to ready');
select public.set_hold(current_setting('t.case')::uuid, false);
do $$ declare f record; begin
  for f in select id from public.case_fields where case_id = current_setting('t.case')::uuid loop perform public.confirm_field(f.id); end loop;
  for f in select id from public.flags where case_id = current_setting('t.case')::uuid loop perform public.resolve_flag(f.id); end loop;
  for f in select id from public.findings where case_id = current_setting('t.case')::uuid loop perform public.set_finding_resolved(f.id, true); end loop;
end $$;
select pg_temp.check(public.criteria_met(current_setting('t.case')::uuid), 'all six criteria met');
select public.mark_ready(current_setting('t.case')::uuid);
select pg_temp.check((select stage from public.cases where id = current_setting('t.case')::uuid) = 'ready', 'on the agenda');
select pg_temp.expect_error('select public.enter_decision(current_setting(''t.case'')::uuid, ''approved'')', 'decision needs the sitting held');
select public.set_sitting_held((select sitting_id from public.cases where id = current_setting('t.case')::uuid), true);
select set_config('t.undo', public.enter_decision(current_setting('t.case')::uuid, 'approved')::text, false);
select pg_temp.check((select minute_no ~ '^MB/\d{2}/\d{4}/Min04\(\d+\)$' from public.cases where id = current_setting('t.case')::uuid), 'minute number generated');
select public.undo_event(current_setting('t.undo')::bigint);
select pg_temp.check((select stage = 'ready' and minute_no is null from public.cases where id = current_setting('t.case')::uuid), 'decision undone');
select pg_temp.check((select count(*) from public.audit_log where action in ('decision', 'undo') and case_id = current_setting('t.case')::uuid) = 2, 'audit keeps both entries');
select public.enter_decision(current_setting('t.case')::uuid, 'approved');
select public.draft_letters(current_setting('t.case')::uuid);
select pg_temp.check((select string_agg(kind::text || ':' || signer || ':' || ref_no, ',' order by sort) from public.letters where case_id = current_setting('t.case')::uuid)
  like 'funder:minister:ADM 85/124/01,extract:board:Minute MB/%,intro:dghs:ADM 85/265/01', 'government referral letter routing');
select pg_temp.check((select addressee from public.letters where case_id = current_setting('t.case')::uuid and kind = 'funder') like '%Prime Minister%', 'funder letter to OPM');
select public.send_for_signature(array[current_setting('t.case')::uuid]);
select public.return_letter((select id from public.letters where case_id = current_setting('t.case')::uuid and kind = 'funder'), 'Spell the doctor''s name as on the acceptance');
select pg_temp.check((select stage from public.cases where id = current_setting('t.case')::uuid) = 'decided', 'returned for correction goes back to decided');
select public.draft_letters(current_setting('t.case')::uuid);
select public.send_for_signature(array[current_setting('t.case')::uuid]);
select public.mark_letter_signed((select id from public.letters where case_id = current_setting('t.case')::uuid and kind = 'funder'));
select pg_temp.check((select stage from public.cases where id = current_setting('t.case')::uuid) = 'signature', 'still waiting for the DGHS letter');
select public.mark_letter_signed((select id from public.letters where case_id = current_setting('t.case')::uuid and kind = 'intro'));
select pg_temp.check((select stage from public.cases where id = current_setting('t.case')::uuid) = 'signed', 'all letters signed');
select pg_temp.logout();

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select public.issue_collection_code(current_setting('t.case')::uuid);
select pg_temp.check(public.record_collection(current_setting('t.case')::uuid, '000000x', 'Jane Collector', 'Sister', '0700', true) = -1, 'wrong code rejected');
select pg_temp.logout();
select set_config('t.code', (select substring(body from 'is (\d{6})') from public.sms_outbox where kind = 'collection_code' order by created_at desc limit 1), false);
select pg_temp.check(not exists (select 1 from public.collection_codes where code_hash = current_setting('t.code')), 'only the hash is stored');
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select public.record_collection(current_setting('t.case')::uuid, current_setting('t.code'), 'Jane Collector', 'Sister', '0700', true);
select pg_temp.check((select stage from public.cases where id = current_setting('t.case')::uuid) = 'collected', 'collected');
select pg_temp.logout();

-- public verify: no health data
select pg_temp.check((select public.verify_lookup(verify_code)::text !~* '(renal|transplant|Test Patient)' from public.letters
  where case_id = current_setting('t.case')::uuid and kind = 'funder'), 'verify shows no health information or patient name');
select public.confirm_receipt_public((select verify_code from public.letters where case_id = current_setting('t.case')::uuid and kind = 'funder'), 'R. Officer', 'Records, OPM');
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select public.confirm_receipt_stamped(l.id, l.case_id || '/' || l.id || '/stamped.jpg', 'Hospital registry')
  from public.letters l where case_id = current_setting('t.case')::uuid and kind = 'intro';
select pg_temp.check((select stage from public.cases where id = current_setting('t.case')::uuid) = 'closed', 'auto-closed when every receipt is confirmed');
select pg_temp.logout();

-- ===== Retirement: police, with cadre document =====
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select set_config('t.r', public.create_case(jsonb_build_object('type','retirement','name','Test Officer Two','gender','Male','dob','1970-06-01',
  'phone','0700333444','sms_consent',false,'employer_id',(select id from public.employers where name = 'Uganda Police Force'),'station','Test Station',
  'custom', '[{"name":"Letter from the Commandant","scope":"police"}]'::jsonb))::text, false);
select pg_temp.check((select count(*) from public.case_documents where case_id = current_setting('t.r')::uuid) = 5, 'retirement checklist + cadre document');
select pg_temp.check(exists (select 1 from public.checklist_for('retirement', null, (select id from public.employers where name = 'Uganda Police Force')) where name = 'Letter from the Commandant'), 'cadre document mapped to police');
select pg_temp.check(not exists (select 1 from public.checklist_for('retirement', null, (select id from public.employers where name = 'Ministry of Health')) where name = 'Letter from the Commandant'), 'cadre document not added for health workers');
do $$ declare d record; begin
  for d in select id, case_id from public.case_documents where case_id = current_setting('t.r')::uuid loop
    perform public.add_page(d.id, d.case_id || '/' || d.id || '/p1.jpg', 1200, 1700, 0.9, '{"ok":true}');
  end loop;
end $$;
select public.send_to_secretariat(current_setting('t.r')::uuid);
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.upsert_field(current_setting('t.r')::uuid, 'name', 'Name on documents', 'Test Officer Two');
do $$ declare f record; begin
  for f in select id from public.case_fields where case_id = current_setting('t.r')::uuid loop perform public.confirm_field(f.id); end loop;
end $$;
select public.mark_ready(current_setting('t.r')::uuid);
select public.set_sitting_held((select sitting_id from public.cases where id = current_setting('t.r')::uuid), true);
select public.enter_decision(current_setting('t.r')::uuid, 'approved');
select public.draft_letters(current_setting('t.r')::uuid);
select pg_temp.check((select addressee || '|' || signer || '|' || ref_no from public.letters where case_id = current_setting('t.r')::uuid)
  = 'The Inspector General of Police|dghs|ADM 85/265/01', 'police retirement letter to the IGP, signed by the DGHS');
select public.send_for_signature(array[current_setting('t.r')::uuid]);
select set_config('t.u', public.mark_letter_signed((select id from public.letters where case_id = current_setting('t.r')::uuid))::text, false);
select public.undo_event(current_setting('t.u')::bigint);
select pg_temp.check((select stage from public.cases where id = current_setting('t.r')::uuid) = 'signature', 'mark signed undone');
select public.mark_letter_signed((select id from public.letters where case_id = current_setting('t.r')::uuid));
select pg_temp.logout();
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check((select (public.issue_collection_code(current_setting('t.r')::uuid) ->> 'sent')::boolean) = false, 'no SMS without consent');
select pg_temp.expect_error('select public.record_collection(current_setting(''t.r'')::uuid, null, ''A'', ''Self'', null, true)', 'no-consent collection needs a reason');
select public.record_collection(current_setting('t.r')::uuid, null, 'Test Officer Two', 'Self', null, true, 'No SMS consent; national ID checked');
select public.confirm_receipt_stamped(l.id, l.case_id || '/' || l.id || '/stamped.jpg') from public.letters l where case_id = current_setting('t.r')::uuid;
select pg_temp.check((select stage from public.cases where id = current_setting('t.r')::uuid) = 'closed', 'retirement case closed');
select pg_temp.check((select count(*) from public.sms_outbox where case_id = current_setting('t.r')::uuid) = 0, 'nothing queued without consent');
select pg_temp.logout();

-- not approved closes, deferred goes back to review
select pg_temp.check((select count(*) from public.sms_outbox where case_id = current_setting('t.case')::uuid and body ~* 'renal|transplant') = 0, 'SMS carry no diagnosis');
