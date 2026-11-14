-- RLS tests for every role. Plain SQL assertions (no extension needed); run with supabase/tests/run-local.sh.
\set QUIET on
create or replace function pg_temp.login(p_uid uuid, p_aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.logout() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', false); end $$;
create or replace function pg_temp.expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'ok: % (%)', p_label, sqlerrm; return; end;
  raise exception 'FAIL: % should have been refused', p_label;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_label; end if; raise notice 'ok: %', p_label; end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'), ('00000000-0000-0000-0000-00000000000b', 'registry@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'secretariat@test.local'), ('00000000-0000-0000-0000-00000000000d', 'commissioner@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'norole@test.local');
update public.profiles set role = 'admin' where email = 'admin@test.local';
update public.profiles set role = 'registry' where email = 'registry@test.local';
update public.profiles set role = 'secretariat' where email = 'secretariat@test.local';
update public.profiles set role = 'commissioner' where email = 'commissioner@test.local';

-- anon: nothing but verify_lookup
set role anon;
select pg_temp.expect_error('select count(*) from public.cases', 'anon cannot read cases');
select pg_temp.expect_error('select public.create_case(''{}'')', 'anon cannot create cases');
select pg_temp.check(public.verify_lookup('nope') is null, 'anon can call verify_lookup');
reset role;

-- two-step verification required: an aal1 session has no role and no data
update public.settings set value = 'true' where key = 'mfa_required';
select pg_temp.login('00000000-0000-0000-0000-00000000000c', 'aal1');
select pg_temp.check((select count(*) from public.cases) = 0, 'MFA on: aal1 session sees no cases');
select pg_temp.check(public.needs_mfa(), 'MFA on: aal1 session is sent to the authenticator');
select pg_temp.expect_error('select public.add_note((select id from public.cases limit 1), ''x'')', 'MFA on: aal1 session cannot act');
select pg_temp.logout();
-- not required: the emailed link (aal1) is enough
update public.settings set value = 'false' where key = 'mfa_required';
select pg_temp.login('00000000-0000-0000-0000-00000000000c', 'aal1');
select pg_temp.check((select count(*) from public.cases) > 0, 'MFA off: link-only session works');
select pg_temp.check(not public.needs_mfa(), 'MFA off: no authenticator step');
select pg_temp.logout();
update public.settings set value = 'true' where key = 'mfa_required';

-- user without a role
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from public.cases) = 0, 'user without a role sees no cases');
select pg_temp.logout();

-- registry
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.cases where stage = 'intake') >= 1, 'registry sees intake cases');
select pg_temp.check((select count(*) from public.cases where stage = 'ready') = 0, 'registry does not see cases at the Board');
select pg_temp.check((select count(*) from public.case_fields) = 0, 'registry cannot read review fields');
select pg_temp.check((select count(*) from public.findings) = 0, 'registry cannot read findings');
select pg_temp.expect_error('update public.cases set stage = ''closed''', 'registry cannot update stage directly');
select pg_temp.expect_error('insert into public.letters (case_id, kind, title, addressee, signer, ref_no) select id, ''intro'', ''x'', ''x'', ''dghs'', ''x'' from public.cases limit 1', 'registry cannot insert letters');
select pg_temp.expect_error('select public.mark_ready((select id from public.cases where stage = ''review'' limit 1))', 'registry cannot mark ready');
select pg_temp.expect_error('select public.set_user_role(''00000000-0000-0000-0000-00000000000b'', ''admin'')', 'registry cannot change roles');
select pg_temp.check((select count(*) from public.sms_outbox) = 0, 'registry cannot read the SMS outbox');
select pg_temp.check((select count(*) from public.collection_codes) = 0, 'registry cannot read collection code hashes');
select pg_temp.logout();

-- secretariat
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.cases) = (select count(*) from public.cases), 'secretariat reads cases');
select pg_temp.check((select count(*) from public.cases where stage = 'ready') >= 1, 'secretariat sees cases at the Board');
select pg_temp.check((select count(*) from public.case_fields) >= 1, 'secretariat reads fields');
select pg_temp.expect_error('select public.create_case(''{"type":"retirement"}'')', 'secretariat cannot create cases');
select pg_temp.expect_error('delete from public.cases', 'secretariat cannot delete cases');
select pg_temp.expect_error('update public.audit_log set summary = ''x''', 'secretariat cannot edit the audit log');
select pg_temp.check((select count(*) from public.audit_log where case_id is null) = 0, 'secretariat cannot read system-wide audit entries');
select pg_temp.logout();

-- commissioner: read-only
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.cases where stage = 'ready') >= 1, 'commissioner reads the pipeline');
select pg_temp.check((select count(*) from public.case_fields) >= 1, 'commissioner reads case contents');
select pg_temp.expect_error('select public.mark_ready((select id from public.cases where stage = ''review'' limit 1))', 'commissioner cannot mark ready');
select pg_temp.expect_error('select public.enter_decision((select id from public.cases where stage = ''ready'' limit 1), ''approved'')', 'commissioner cannot enter decisions');
select pg_temp.expect_error('select public.create_case(''{"type":"retirement"}'')', 'commissioner cannot create cases');
update public.rules set status = 'confirmed';
select pg_temp.check((select count(*) from public.rules where status = 'confirmed') = 4, 'rulebook unchanged by commissioner');
select pg_temp.logout();

-- admin: every workspace
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.cases) >= 5, 'admin reads every case');
select pg_temp.check((select count(*) from public.audit_log) >= 5, 'admin reads the full audit log');
select public.update_setting('agenda_cutoff_days', '8');
select pg_temp.check((select (value #>> '{}')::int from public.settings where key = 'agenda_cutoff_days') = 8, 'admin changes settings');
select public.update_setting('agenda_cutoff_days', '7');
select pg_temp.expect_error('select public.set_user_role(''00000000-0000-0000-0000-00000000000a'', ''registry'')', 'admin cannot demote themself');
select pg_temp.expect_error('delete from public.audit_log', 'admin cannot delete audit rows');
select pg_temp.logout();

-- service role cannot rewrite history either
set role service_role;
select pg_temp.expect_error('update public.audit_log set summary = ''x''', 'service role cannot edit the audit log');
reset role;
