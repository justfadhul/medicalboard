-- Workflow logic. Every state change goes through these security definer functions.

-- Roles ------------------------------------------------------------------------
-- Returns the caller's role, only for an active profile on an MFA-verified (aal2) session.
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.active and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Admin acts in every workspace.
create or replace function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin' or public.my_role() = any (roles), false)
$$;

create or replace function public.require_role(variadic roles public.app_role[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(variadic roles) then
    raise exception 'Not allowed for your role' using errcode = '42501';
  end if;
end $$;

create or replace function public.setting(k text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.settings where key = k
$$;

create or replace function public.log_event(p_case uuid, p_action text, p_summary text,
  p_detail jsonb default '{}', p_undoable boolean default false, p_reverses bigint default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_label text;
begin
  select coalesce(nullif(full_name, ''), email) || ' (' || coalesce(role::text, 'no role') || ')'
    into v_label from public.profiles where id = auth.uid();
  insert into public.audit_log (case_id, actor, actor_label, action, summary, detail, undoable, reverses)
  values (p_case, auth.uid(), coalesce(v_label, 'System'), p_action, p_summary, p_detail, p_undoable, p_reverses)
  returning id into v_id;
  return v_id;
end $$;

-- Small pure helpers --------------------------------------------------------------
create or replace function public.age_on(p_dob date, p_on date default current_date) returns int
language sql immutable as $$ select extract(year from age(p_on, p_dob))::int $$;

create or replace function public.second_thursday(y int, m int) returns date
language sql immutable as $$
  select make_date(y, m, 1) + ((4 - extract(dow from make_date(y, m, 1))::int + 7) % 7) + 7
$$;

create or replace function public.minute_number(p_sitting date, p_serial int) returns text
language sql immutable as $$
  select 'MB/' || to_char(p_sitting, 'MM') || '/' || to_char(p_sitting, 'YYYY') || '/Min04(' || p_serial || ')'
$$;

create or replace function public.safe_date(t text) returns date
language plpgsql immutable as $$
begin return t::date; exception when others then return null; end $$;

create or replace function public.digits_amount(t text) returns numeric
language sql immutable as $$
  select nullif(regexp_replace(split_part(coalesce(t, ''), '.', 1), '[^0-9]', '', 'g'), '')::numeric
$$;

-- "forty five thousand two hundred" -> 45200
create or replace function public.words_to_number(t text) returns numeric
language plpgsql immutable as $$
declare
  w text; total numeric := 0; cur numeric := 0; n numeric; seen boolean := false;
  units constant jsonb := '{"zero":0,"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8,"nine":9,
    "ten":10,"eleven":11,"twelve":12,"thirteen":13,"fourteen":14,"fifteen":15,"sixteen":16,"seventeen":17,"eighteen":18,
    "nineteen":19,"twenty":20,"thirty":30,"forty":40,"fifty":50,"sixty":60,"seventy":70,"eighty":80,"ninety":90}';
begin
  foreach w in array regexp_split_to_array(lower(regexp_replace(coalesce(t, ''), '[^a-zA-Z ]', ' ', 'g')), '\s+') loop
    if w = '' or w = 'and' then continue; end if;
    if units ? w then cur := cur + (units ->> w)::numeric; seen := true;
    elsif w = 'hundred' then cur := greatest(cur, 1) * 100; seen := true;
    elsif w in ('thousand', 'million', 'billion') then
      n := case w when 'thousand' then 1000 when 'million' then 1000000 else 1000000000 end;
      total := total + greatest(cur, 1) * n; cur := 0; seen := true;
    end if;
  end loop;
  if not seen then return null; end if;
  return total + cur;
end $$;

create or replace function public.norm_name(t text) returns text
language sql immutable as $$
  select array_to_string(array(select x from unnest(regexp_split_to_array(lower(trim(regexp_replace(coalesce(t, ''), '[^a-zA-Z ]', ' ', 'g'))), '\s+')) x
    where x <> '' order by x), ' ')
$$;

-- Sittings ----------------------------------------------------------------------
create or replace function public.ensure_sittings(p_months int default 12) returns void
language plpgsql security definer set search_path = public as $$
declare d date; i int; v_cut int := coalesce((public.setting('agenda_cutoff_days') #>> '{}')::int, 7);
  v_venue text := coalesce(public.setting('default_venue') #>> '{}', 'Mulago Specialised Women and Neonatal Hospital, Level 2');
begin
  for i in 0 .. p_months loop
    d := public.second_thursday(extract(year from current_date + make_interval(months => i))::int,
                                extract(month from current_date + make_interval(months => i))::int);
    insert into public.sittings (sitting_date, venue, cutoff_date) values (d, v_venue, d - v_cut)
    on conflict (sitting_date) do nothing;
  end loop;
end $$;

create or replace function public.next_open_sitting() returns public.sittings
language plpgsql security definer set search_path = public as $$
declare s public.sittings;
begin
  perform public.ensure_sittings(3);
  select * into s from public.sittings where not held and cutoff_date >= current_date order by sitting_date limit 1;
  return s;
end $$;

-- SMS outbox ------------------------------------------------------------------------
create or replace function public.queue_sms(p_case uuid, p_kind text, p_body text, p_force_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.cases; v_id uuid;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null or not c.sms_consent or coalesce(coalesce(p_force_phone, c.phone), '') = '' then return null; end if;
  insert into public.sms_outbox (case_id, to_phone, body, kind) values (p_case, coalesce(p_force_phone, c.phone), p_body, p_kind)
  returning id into v_id;
  return v_id;
end $$;

-- Checklist ----------------------------------------------------------------------
create or replace function public.employer_cadre(p_employer int) returns public.cadre
language sql stable security definer set search_path = public as $$
  select cadre from public.employers where id = p_employer
$$;

create or replace function public.checklist_for(p_type public.case_type, p_procedure text, p_employer int)
returns table (catalog_key text, name text, source text, rule_id text, can_na boolean, sort int, tag text)
language sql stable security definer set search_path = public as $$
  select d.key, d.name, 'standard', d.rule_id, d.can_na, d.sort, null::text
    from public.doc_catalog d where d.case_type = p_type and not d.transplant
  union all
  select d.key, d.name, 'transplant', d.rule_id, d.can_na, d.sort, 'Transplant'
    from public.doc_catalog d where d.transplant and p_type = 'referral' and coalesce(p_procedure, '') ilike '%transplant%'
  union all
  select null, m.name, 'cadre', null, false, 500,
         'Required for ' || case m.scope when 'police' then 'all police officers' when 'teachers' then 'all teachers'
           when 'health' then 'all health workers' when 'lg' then 'all local government staff' else 'all retirement cases' end
    from public.cadre_docs m
   where p_type = 'retirement' and (m.scope = 'all' or m.scope = public.employer_cadre(p_employer))
  order by 6, 2
$$;

create or replace function public.find_duplicates(p_name text, p_dob date, p_exclude uuid default null)
returns table (id uuid, case_no text, name text, stage public.case_stage)
language sql stable security definer set search_path = public as $$
  select c.id, c.case_no, c.name, c.stage from public.cases c
  where public.has_role('registry', 'secretariat', 'commissioner')
    and public.norm_name(c.name) = public.norm_name(p_name) and c.dob = p_dob
    and (p_exclude is null or c.id <> p_exclude)
$$;

-- Cases --------------------------------------------------------------------------
-- p: {type,name,gender,dob,stated_age,phone,sms_consent,employer_id,station,funding,funding_body,procedure,country,
--     diagnosis,referring_doctor,receiving_doctor,receiving_centre,cost_figures,cost_words,duration,accompanying,earlier_referral,
--     docs:[{catalog_key|name, status, reason}], custom:[{name, scope, status, reason}]}
create or replace function public.create_case(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_no text; v_type public.case_type := (p ->> 'type')::public.case_type; r record; d jsonb; v_status public.receipt_status;
begin
  perform public.require_role('registry');
  v_no := 'UMB-' || to_char(current_date, 'YY') || '-' || nextval('public.case_no_seq');
  insert into public.cases (case_no, type, name, gender, dob, stated_age, phone, sms_consent, employer_id, station, funding, funding_body,
    procedure, country, diagnosis, referring_doctor, receiving_doctor, receiving_centre, cost_figures, cost_words, duration, accompanying,
    earlier_referral, created_by)
  values (v_no, v_type, trim(p ->> 'name'), p ->> 'gender', (p ->> 'dob')::date, nullif(p ->> 'stated_age', '')::int,
    nullif(p ->> 'phone', ''), coalesce((p ->> 'sms_consent')::boolean, false),
    case when v_type = 'retirement' then nullif(p ->> 'employer_id', '')::int end, p ->> 'station',
    case when v_type = 'referral' then nullif(p ->> 'funding', '')::public.funding_source end, p ->> 'funding_body',
    p ->> 'procedure', p ->> 'country', p ->> 'diagnosis', p ->> 'referring_doctor', p ->> 'receiving_doctor', p ->> 'receiving_centre',
    p ->> 'cost_figures', p ->> 'cost_words', p ->> 'duration', p ->> 'accompanying', coalesce((p ->> 'earlier_referral')::boolean, false),
    auth.uid())
  returning id into v_id;

  for r in select * from public.checklist_for(v_type, p ->> 'procedure', nullif(p ->> 'employer_id', '')::int) loop
    select x into d from jsonb_array_elements(coalesce(p -> 'docs', '[]')) x
     where (r.catalog_key is not null and x ->> 'catalog_key' = r.catalog_key) or (r.catalog_key is null and x ->> 'name' = r.name) limit 1;
    v_status := coalesce((d ->> 'status')::public.receipt_status, 'received');
    if v_status = 'not_applicable' and not r.can_na then v_status := 'received'; end if;
    insert into public.case_documents (case_id, catalog_key, name, source, rule_id, can_na, status, reason, sort)
    values (v_id, r.catalog_key, r.name, r.source, r.rule_id, r.can_na, v_status, nullif(d ->> 'reason', ''), r.sort);
  end loop;

  for d in select * from jsonb_array_elements(coalesce(p -> 'custom', '[]')) loop
    if coalesce(d ->> 'scope', 'case') <> 'case' and v_type = 'retirement' then
      insert into public.cadre_docs (name, scope, created_by) values (d ->> 'name', (d ->> 'scope')::public.cadre, auth.uid())
      on conflict do nothing;
    end if;
    if not exists (select 1 from public.case_documents where case_id = v_id and lower(name) = lower(d ->> 'name')) then
      insert into public.case_documents (case_id, name, source, status, reason, sort)
      values (v_id, d ->> 'name', case when coalesce(d ->> 'scope', 'case') = 'case' then 'custom' else 'cadre' end,
              coalesce((d ->> 'status')::public.receipt_status, 'received'), nullif(d ->> 'reason', ''), 600);
    end if;
  end loop;

  perform public.log_event(v_id, 'case_created', 'Case created by the Registry');
  perform public.queue_sms(v_id, 'received', 'UMB: We have received the application of ' || trim(p ->> 'name') || ' (case ' || v_no
    || '). We will send you an SMS at each step.');
  perform public.refresh_flags(v_id);
  return v_id;
end $$;

create or replace function public.update_case(p_case uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases;
begin
  select * into c from public.cases where id = p_case for update;
  if c.stage = 'intake' then perform public.require_role('registry', 'secretariat');
  else perform public.require_role('secretariat'); end if;
  if c.stage in ('signed', 'collected', 'closed') then raise exception 'Particulars are locked once letters are signed'; end if;
  update public.cases set
    name = coalesce(p ->> 'name', name), gender = coalesce(p ->> 'gender', gender), dob = coalesce((p ->> 'dob')::date, dob),
    stated_age = case when p ? 'stated_age' then nullif(p ->> 'stated_age', '')::int else stated_age end,
    phone = coalesce(p ->> 'phone', phone), sms_consent = coalesce((p ->> 'sms_consent')::boolean, sms_consent),
    employer_id = coalesce(nullif(p ->> 'employer_id', '')::int, employer_id), station = coalesce(p ->> 'station', station),
    funding = coalesce(nullif(p ->> 'funding', '')::public.funding_source, funding), funding_body = coalesce(p ->> 'funding_body', funding_body),
    procedure = coalesce(p ->> 'procedure', procedure), country = coalesce(p ->> 'country', country),
    diagnosis = coalesce(p ->> 'diagnosis', diagnosis), referring_doctor = coalesce(p ->> 'referring_doctor', referring_doctor),
    receiving_doctor = coalesce(p ->> 'receiving_doctor', receiving_doctor), receiving_centre = coalesce(p ->> 'receiving_centre', receiving_centre),
    cost_figures = coalesce(p ->> 'cost_figures', cost_figures), cost_words = coalesce(p ->> 'cost_words', cost_words),
    duration = coalesce(p ->> 'duration', duration), accompanying = coalesce(p ->> 'accompanying', accompanying),
    earlier_referral = coalesce((p ->> 'earlier_referral')::boolean, earlier_referral), updated_at = now()
  where id = p_case;
  perform public.log_event(p_case, 'case_updated', 'Particulars updated', jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p) k)));
  perform public.refresh_flags(p_case);
end $$;

create or replace function public.case_editable_docs(p_case uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_stage public.case_stage;
begin
  select stage into v_stage from public.cases where id = p_case;
  if v_stage = 'intake' then perform public.require_role('registry', 'secretariat');
  elsif v_stage = 'review' then perform public.require_role('secretariat', 'registry');
  else raise exception 'Documents can only change during intake or review'; end if;
end $$;

create or replace function public.set_document_status(p_doc uuid, p_status public.receipt_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare d public.case_documents;
begin
  select * into d from public.case_documents where id = p_doc;
  perform public.case_editable_docs(d.case_id);
  if p_status = 'not_brought' and coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason the document was not brought'; end if;
  if p_status = 'not_applicable' and not d.can_na then raise exception 'This document cannot be marked not applicable'; end if;
  update public.case_documents set status = p_status, reason = case when p_status = 'received' then null else p_reason end where id = p_doc;
  perform public.log_event(d.case_id, 'document_status', d.name || ': ' || replace(p_status::text, '_', ' '));
  perform public.refresh_flags(d.case_id);
end $$;

create or replace function public.add_document(p_case uuid, p_name text, p_scope public.cadre default null,
  p_status public.receipt_status default 'not_brought', p_reason text default 'Requested')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_type public.case_type;
begin
  perform public.case_editable_docs(p_case);
  if coalesce(trim(p_name), '') = '' then raise exception 'Name the document'; end if;
  select type into v_type from public.cases where id = p_case;
  if p_scope is not null then
    if v_type <> 'retirement' then raise exception 'Cadre documents apply to retirement cases only'; end if;
    insert into public.cadre_docs (name, scope, created_by) values (trim(p_name), p_scope, auth.uid()) on conflict do nothing;
  end if;
  select id into v_id from public.case_documents where case_id = p_case and lower(name) = lower(trim(p_name));
  if v_id is null then
    insert into public.case_documents (case_id, name, source, status, reason, sort)
    values (p_case, trim(p_name), case when p_scope is null then 'custom' else 'cadre' end, p_status,
            case when p_status = 'not_brought' then coalesce(nullif(p_reason, ''), 'Requested') end, 600)
    returning id into v_id;
    perform public.log_event(p_case, 'document_added', 'Document added to the checklist: ' || trim(p_name));
  end if;
  return v_id;
end $$;

create or replace function public.remove_document(p_doc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.case_documents;
begin
  select * into d from public.case_documents where id = p_doc;
  perform public.case_editable_docs(d.case_id);
  if d.source in ('standard', 'transplant') then raise exception 'Standard documents cannot be removed; mark them not brought instead'; end if;
  if exists (select 1 from public.document_pages where document_id = p_doc) then raise exception 'Delete the scanned pages first'; end if;
  delete from public.case_documents where id = p_doc;
  perform public.log_event(d.case_id, 'document_removed', 'Document removed from the checklist: ' || d.name);
end $$;

-- Scanned pages ----------------------------------------------------------------------
create or replace function public.add_page(p_doc uuid, p_path text, p_width int, p_height int, p_score numeric,
  p_quality jsonb default null, p_keep_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.case_documents; v_id uuid; v_n int;
begin
  perform public.require_role('registry', 'secretariat');
  select * into d from public.case_documents where id = p_doc;
  if d.id is null then raise exception 'Unknown document'; end if;
  if p_path not like d.case_id || '/' || d.id || '/%' then raise exception 'Page path does not match the document'; end if;
  if coalesce((p_quality ->> 'ok')::boolean, true) = false and coalesce(trim(p_keep_reason), '') = '' then
    raise exception 'A page that failed the quality check needs a reason to keep it';
  end if;
  select id into v_id from public.document_pages where path = p_path;
  if v_id is not null then return v_id; end if;  -- idempotent retries from the upload queue
  select coalesce(max(page_no), 0) + 1 into v_n from public.document_pages where document_id = p_doc;
  insert into public.document_pages (document_id, case_id, page_no, path, width, height, quality_score, quality, keep_reason, scanned_by)
  values (p_doc, d.case_id, v_n, p_path, p_width, p_height, p_score, p_quality, p_keep_reason, auth.uid()) returning id into v_id;
  if d.status <> 'received' then update public.case_documents set status = 'received', reason = null where id = p_doc; end if;
  update public.case_documents set pdf_path = null where id = p_doc;
  perform public.log_event(d.case_id, 'page_scanned', d.name || ': page ' || v_n || ' scanned');
  return v_id;
end $$;

create or replace function public.delete_page(p_page uuid) returns text
language plpgsql security definer set search_path = public as $$
declare pg public.document_pages;
begin
  select * into pg from public.document_pages where id = p_page;
  perform public.case_editable_docs(pg.case_id);
  delete from public.document_pages where id = p_page;
  update public.document_pages set page_no = page_no - 1 where document_id = pg.document_id and page_no > pg.page_no;
  update public.case_documents set pdf_path = null where id = pg.document_id;
  perform public.log_event(pg.case_id, 'page_deleted', 'Scanned page ' || pg.page_no || ' deleted');
  return pg.path;
end $$;

create or replace function public.move_page(p_page uuid, p_doc uuid, p_position int default null) returns void
language plpgsql security definer set search_path = public as $$
declare pg public.document_pages; v_n int;
begin
  select * into pg from public.document_pages where id = p_page;
  perform public.case_editable_docs(pg.case_id);
  if not exists (select 1 from public.case_documents where id = p_doc and case_id = pg.case_id) then raise exception 'Wrong case'; end if;
  update public.document_pages set page_no = page_no - 1 where document_id = pg.document_id and page_no > pg.page_no;
  select coalesce(max(page_no), 0) + 1 into v_n from public.document_pages where document_id = p_doc and id <> p_page;
  if p_position is not null and p_position < v_n then
    update public.document_pages set page_no = page_no + 1 where document_id = p_doc and page_no >= p_position and id <> p_page;
    v_n := greatest(p_position, 1);
  end if;
  update public.document_pages set document_id = p_doc, page_no = v_n where id = p_page;
  update public.case_documents set pdf_path = null where id in (p_doc, pg.document_id);
  update public.case_documents set status = 'received', reason = null where id = p_doc and status <> 'received';
end $$;

create or replace function public.set_page_rotation(p_page uuid, p_rotation int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role('registry', 'secretariat');
  update public.document_pages set rotation = ((p_rotation % 360) + 360) % 360 where id = p_page;
end $$;

create or replace function public.set_document_pdf(p_doc uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role('registry', 'secretariat');
  update public.case_documents set pdf_path = p_path where id = p_doc;
end $$;

-- Phone pairing: 10-minute single-use token, only its hash is stored.
create or replace function public.create_scan_pairing(p_case uuid, p_doc uuid, p_batch boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text := encode(extensions.gen_random_bytes(18), 'base64');
begin
  perform public.require_role('registry', 'secretariat');
  v_token := translate(v_token, '+/=', '-_');
  insert into public.scan_pairings (token_hash, case_id, document_id, batch, created_by, expires_at)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_case, p_doc, p_batch, auth.uid(), now() + interval '10 minutes');
  perform public.log_event(p_case, 'phone_pairing', 'Phone scanning pairing created');
  return v_token;
end $$;

create or replace function public.claim_scan_pairing(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.scan_pairings;
begin
  perform public.require_role('registry', 'secretariat');
  select * into s from public.scan_pairings where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if s.id is null then raise exception 'This pairing code is not valid'; end if;
  if s.claimed_at is not null then raise exception 'This pairing code has already been used'; end if;
  if s.expires_at < now() then raise exception 'This pairing code has expired; create a new one'; end if;
  update public.scan_pairings set claimed_by = auth.uid(), claimed_at = now() where id = s.id;
  return jsonb_build_object('case_id', s.case_id, 'document_id', s.document_id, 'batch', s.batch);
end $$;

-- Review: fields, flags, findings ------------------------------------------------------
create or replace function public.upsert_field(p_case uuid, p_key text, p_label text, p_value text,
  p_doc uuid default null, p_page int default null, p_bbox jsonb default null, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  perform public.require_role('secretariat');
  if v_id is null then
    insert into public.case_fields (case_id, key, label, value, document_id, page_no, bbox)
    values (p_case, p_key, p_label, p_value, p_doc, p_page, p_bbox) returning id into v_id;
  else
    update public.case_fields set value = p_value, label = p_label, document_id = coalesce(p_doc, document_id),
      page_no = coalesce(p_page, page_no), bbox = coalesce(p_bbox, bbox), confirmed = false, confirmed_by = null, confirmed_at = null
    where id = v_id and case_id = p_case;
  end if;
  perform public.refresh_flags(p_case);
  return v_id;
end $$;

create or replace function public.confirm_field(p_field uuid, p_confirmed boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare f public.case_fields;
begin
  perform public.require_role('secretariat');
  update public.case_fields set confirmed = p_confirmed, confirmed_by = case when p_confirmed then auth.uid() end,
    confirmed_at = case when p_confirmed then now() end where id = p_field returning * into f;
  perform public.log_event(f.case_id, 'field_confirmed', f.label || case when p_confirmed then ' confirmed against the scan: ' else ' unconfirmed: ' end || f.value);
  perform public.refresh_flags(f.case_id);
end $$;

create or replace function public.field_val(p_case uuid, p_key text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(value order by created_at), '{}') from public.case_fields where case_id = p_case and key = p_key and trim(value) <> ''
$$;

create or replace function public.refresh_flags(p_case uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases; f record; v_active text[] := '{}'; v_text text; v_lim int; v_a numeric; v_b numeric; v_x text;
  v_kw text;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null then return; end if;

  -- name spelled differently
  if (select count(distinct public.norm_name(x)) from unnest(public.field_val(p_case, 'name') || c.name) x) > 1 then
    v_active := v_active || 'name_mismatch'::text;
    perform public.upsert_flag(p_case, 'name_mismatch', 'The name is spelled differently across documents: '
      || (select string_agg(distinct x, ' / ') from unnest(public.field_val(p_case, 'name') || c.name) x) || '.');
  end if;
  -- stated age vs age from date of birth
  for v_x in select x from unnest(public.field_val(p_case, 'stated_age') || coalesce(c.stated_age::text, '')) x where x <> '' loop
    if public.digits_amount(v_x) is not null and public.digits_amount(v_x) <> public.age_on(c.dob) then
      v_active := v_active || 'age_mismatch'::text;
      perform public.upsert_flag(p_case, 'age_mismatch', 'Stated age ' || v_x || ' does not match the age from the date of birth ('
        || public.age_on(c.dob) || '). Letters use the age from the date of birth.');
      exit;
    end if;
  end loop;
  -- date of birth on documents differs from the case
  if exists (select 1 from unnest(public.field_val(p_case, 'dob')) x where public.safe_date(x) is not null and public.safe_date(x) <> c.dob) then
    v_active := v_active || 'dob_mismatch'::text;
    perform public.upsert_flag(p_case, 'dob_mismatch', 'A date of birth read from the documents differs from the one recorded at intake.');
  end if;
  -- consultant report older than R-04 limit
  select limit_days into v_lim from public.rules where id = 'R-04';
  if c.type = 'retirement' and v_lim is not null then
    if exists (select 1 from unnest(public.field_val(p_case, 'report_date')) x where public.safe_date(x) < current_date - v_lim) then
      v_active := v_active || 'report_old'::text;
      perform public.upsert_flag(p_case, 'report_old', 'The consultant report is older than the ' || v_lim || '-day limit (R-04).');
    end if;
  end if;
  -- cost in figures vs words vs quote
  if c.type = 'referral' then
    v_a := public.digits_amount(coalesce((public.field_val(p_case, 'cost_figures'))[1], c.cost_figures));
    v_b := public.words_to_number(coalesce((public.field_val(p_case, 'cost_words'))[1], c.cost_words));
    if v_a is not null and v_b is not null and v_a <> v_b then
      v_active := v_active || 'cost_mismatch'::text;
      perform public.upsert_flag(p_case, 'cost_mismatch', 'The cost in figures (' || v_a || ') does not match the cost in words (' || v_b || ').');
    elsif v_a is not null and exists (select 1 from unnest(public.field_val(p_case, 'quote_amount')) x where public.digits_amount(x) <> v_a) then
      v_active := v_active || 'cost_mismatch'::text;
      perform public.upsert_flag(p_case, 'cost_mismatch', 'The cost on the form does not match the quote from the receiving centre.');
    end if;
    -- receiving doctor differs between referral and acceptance
    if (select count(distinct public.norm_name(x)) from unnest(public.field_val(p_case, 'receiving_doctor') || coalesce(c.receiving_doctor, '')) x where x <> '') > 1 then
      v_active := v_active || 'doctor_mismatch'::text;
      perform public.upsert_flag(p_case, 'doctor_mismatch', 'The receiving doctor differs between the referral and the acceptance letter.');
    end if;
    -- funding source vs commitment letter
    v_kw := case c.funding when 'family' then '(family|self|personal|relative)' when 'government' then '(government|ministry|prime minister|opm|agency)'
      when 'judiciary' then '(judiciary|judicial|chief justice)' when 'parliament' then '(parliament)' end;
    if v_kw is not null and exists (select 1 from unnest(public.field_val(p_case, 'funding_source')) x where lower(x) !~ v_kw) then
      v_active := v_active || 'funding_mismatch'::text;
      perform public.upsert_flag(p_case, 'funding_mismatch', 'The funding source on the form does not match the commitment letter.');
    end if;
    -- earlier referral without a treatment report
    if c.earlier_referral and not exists (select 1 from public.case_documents d where d.case_id = p_case and d.catalog_key = 'earlier_report'
         and d.status = 'received' and exists (select 1 from public.document_pages pg where pg.document_id = d.id)) then
      v_active := v_active || 'earlier_no_report'::text;
      perform public.upsert_flag(p_case, 'earlier_no_report', 'The patient was referred abroad before, but no treatment report is on file.');
    end if;
  end if;
  -- possible duplicate
  select string_agg(x.case_no || ' (' || x.stage || ')', ', ') into v_text from public.cases x
   where x.id <> p_case and public.norm_name(x.name) = public.norm_name(c.name) and x.dob = c.dob;
  if v_text is not null then
    v_active := v_active || 'duplicate'::text;
    perform public.upsert_flag(p_case, 'duplicate', 'Possible duplicate: same name and date of birth as ' || v_text || '.');
  end if;
  -- drop unresolved flags whose condition has cleared
  delete from public.flags where case_id = p_case and not resolved and not (code = any (v_active));
end $$;

create or replace function public.upsert_flag(p_case uuid, p_code text, p_text text) returns void
language sql security definer set search_path = public as $$
  insert into public.flags (case_id, code, text) values (p_case, p_code, p_text)
  on conflict (case_id, code) do update set text = excluded.text where not public.flags.resolved
$$;

create or replace function public.resolve_flag(p_flag uuid, p_resolved boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare f public.flags;
begin
  perform public.require_role('secretariat');
  update public.flags set resolved = p_resolved, resolved_by = case when p_resolved then auth.uid() end,
    resolved_at = case when p_resolved then now() end where id = p_flag returning * into f;
  perform public.log_event(f.case_id, 'flag_resolved', case when p_resolved then 'Flag resolved: ' else 'Flag reopened: ' end || f.text);
end $$;

create or replace function public.add_finding(p_case uuid, p_doc uuid, p_type public.finding_type, p_what text,
  p_reasoning text, p_effect public.finding_effect)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_doc uuid := p_doc; v_case_no text; v_person text;
begin
  perform public.require_role('secretariat');
  if coalesce(trim(p_what), '') = '' then raise exception 'Say what is missing or wrong'; end if;
  if p_type = 'missing_document' then
    select id into v_doc from public.case_documents where case_id = p_case and lower(name) = lower(trim(p_what));
    if v_doc is null and p_doc is not null and exists (select 1 from public.case_documents where id = p_doc and status = 'not_brought') then
      v_doc := p_doc;
    end if;
    if v_doc is null then
      insert into public.case_documents (case_id, name, source, status, reason, sort)
      values (p_case, trim(p_what), 'finding', 'not_brought', 'Requested by the Secretariat during review', 650) returning id into v_doc;
    end if;
    select case_no, name into v_case_no, v_person from public.cases where id = p_case;
    insert into public.notes (case_id, body, tag_role, created_by)
    values (p_case, 'Please obtain: ' || trim(p_what) || ' (' || v_person || ', ' || v_case_no || ').', 'registry', auth.uid());
  end if;
  insert into public.findings (case_id, document_id, type, what, reasoning, effect, created_by)
  values (p_case, v_doc, p_type, trim(p_what), coalesce(p_reasoning, ''), p_effect, auth.uid()) returning id into v_id;
  select name into v_name from public.case_documents where id = v_doc;
  perform public.log_event(p_case, 'finding_added', 'Finding recorded' || coalesce(' on ' || v_name, '') || ': ' || trim(p_what));
  return v_id;
end $$;

create or replace function public.set_finding_resolved(p_finding uuid, p_resolved boolean) returns void
language plpgsql security definer set search_path = public as $$
declare f public.findings;
begin
  perform public.require_role('secretariat');
  update public.findings set resolved = p_resolved, resolved_at = case when p_resolved then now() end where id = p_finding returning * into f;
  perform public.log_event(f.case_id, 'finding_' || case when p_resolved then 'resolved' else 'reopened' end,
    case when p_resolved then 'Finding resolved: ' else 'Finding reopened: ' end || f.what);
end $$;

-- Criteria ------------------------------------------------------------------------------------
create or replace function public.case_criteria(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.cases; v_docs text; v_adv text; v_scan text; v_fields int; v_unconf int; v_flags int; v_find int;
begin
  select * into c from public.cases where id = p_case;
  select string_agg(d.name, ', ' order by d.sort) into v_docs from public.case_documents d left join public.rules r on r.id = d.rule_id
   where d.case_id = p_case and d.status = 'not_brought' and (d.rule_id is null or r.status = 'confirmed');
  select string_agg(d.name, ', ' order by d.sort) into v_adv from public.case_documents d join public.rules r on r.id = d.rule_id
   where d.case_id = p_case and d.status = 'not_brought' and r.status <> 'confirmed';
  select string_agg(d.name, ', ' order by d.sort) into v_scan from public.case_documents d
   where d.case_id = p_case and d.status = 'received' and not exists (select 1 from public.document_pages pg where pg.document_id = d.id);
  select count(*), count(*) filter (where not confirmed) into v_fields, v_unconf from public.case_fields where case_id = p_case;
  select count(*) into v_flags from public.flags where case_id = p_case and not resolved;
  select count(*) into v_find from public.findings where case_id = p_case and not resolved and effect = 'block';
  return jsonb_build_array(
    jsonb_build_object('key', 'docs', 'label', 'Required documents received', 'ok', v_docs is null,
      'note', coalesce('Missing: ' || v_docs, 'All received') || coalesce('. Advisory (rule not yet confirmed): ' || v_adv, '')),
    jsonb_build_object('key', 'scans', 'label', 'Received documents scanned', 'ok', v_scan is null, 'note', coalesce('Not scanned: ' || v_scan, 'All scanned')),
    jsonb_build_object('key', 'fields', 'label', 'Fields confirmed', 'ok', v_fields > 0 and v_unconf = 0,
      'note', case when v_fields = 0 then 'No fields read from the scans yet' else v_unconf || ' of ' || v_fields || ' still to confirm' end),
    jsonb_build_object('key', 'flags', 'label', 'Flags resolved', 'ok', v_flags = 0, 'note', v_flags || ' open'),
    jsonb_build_object('key', 'findings', 'label', 'Blocking findings resolved', 'ok', v_find = 0, 'note', v_find || ' open'),
    jsonb_build_object('key', 'hold', 'label', 'Not on hold', 'ok', not c.hold, 'note', coalesce(case when c.hold then c.hold_reason end, 'Not on hold'))
  );
end $$;

create or replace function public.criteria_met(p_case uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select bool_and((x ->> 'ok')::boolean) from jsonb_array_elements(public.case_criteria(p_case)) x
$$;

-- Stage transitions -------------------------------------------------------------------------
create or replace function public.set_stage(p_case uuid, p_stage public.case_stage) returns void
language sql security definer set search_path = public as $$
  update public.cases set stage = p_stage, stage_entered_at = now(), updated_at = now() where id = p_case
$$;
revoke execute on function public.set_stage(uuid, public.case_stage) from public, anon, authenticated;

create or replace function public.send_to_secretariat(p_case uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases; v_bad text;
begin
  perform public.require_role('registry');
  select * into c from public.cases where id = p_case for update;
  if c.stage <> 'intake' then raise exception 'The case is not in intake'; end if;
  select string_agg(d.name, ', ') into v_bad from public.case_documents d
   where d.case_id = p_case and d.status = 'received' and not exists (select 1 from public.document_pages pg where pg.document_id = d.id);
  if v_bad is not null then raise exception 'Scan every received document first: %', v_bad; end if;
  if exists (select 1 from public.case_documents where case_id = p_case and status = 'not_brought' and coalesce(reason, '') = '') then
    raise exception 'Give a reason for every missing document';
  end if;
  perform public.set_stage(p_case, 'review');
  perform public.log_event(p_case, 'stage', 'Sent to the Secretariat for review');
  perform public.queue_sms(p_case, 'review', 'UMB: Case ' || c.case_no || ' has been sent to the Medical Board Secretariat for review.');
end $$;

create or replace function public.return_to_registry(p_case uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases;
begin
  perform public.require_role('secretariat');
  select * into c from public.cases where id = p_case for update;
  if c.stage <> 'review' then raise exception 'Only cases in review can be returned'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say why the case is being returned'; end if;
  perform public.set_stage(p_case, 'intake');
  insert into public.notes (case_id, body, tag_role, created_by) values (p_case, 'Returned to the Registry: ' || p_note, 'registry', auth.uid());
  perform public.log_event(p_case, 'stage', 'Returned to the Registry: ' || p_note);
end $$;

create or replace function public.set_hold(p_case uuid, p_hold boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.cases;
begin
  perform public.require_role('secretariat');
  select * into c from public.cases where id = p_case for update;
  if p_hold and c.stage <> 'review' then raise exception 'Only cases in review can be put on hold'; end if;
  if p_hold and coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the hold'; end if;
  update public.cases set hold = p_hold, hold_reason = case when p_hold then p_reason end, updated_at = now() where id = p_case;
  perform public.log_event(p_case, 'hold', case when p_hold then 'Put on hold: ' || p_reason else 'Hold released' end);
end $$;

create or replace function public.mark_ready(p_case uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cases; s public.sittings; v_serial int;
begin
  perform public.require_role('secretariat');
  select * into c from public.cases where id = p_case for update;
  if c.stage <> 'review' then raise exception 'Only cases in review can be marked ready'; end if;
  if c.hold then raise exception 'The case is on hold'; end if;
  if not public.criteria_met(p_case) then raise exception 'Not every criterion is met yet'; end if;
  s := public.next_open_sitting();
  perform pg_advisory_xact_lock(hashtext(s.id::text));
  select coalesce(max(agenda_serial), 0) + 1 into v_serial from public.cases where sitting_id = s.id;
  update public.cases set sitting_id = s.id, agenda_serial = v_serial where id = p_case;
  perform public.set_stage(p_case, 'ready');
  perform public.log_event(p_case, 'stage', 'Marked ready for the Board; on the agenda of ' || to_char(s.sitting_date, 'FMDay FMDD FMMonth YYYY') || ' as S/N ' || v_serial);
  perform public.queue_sms(p_case, 'agenda', 'UMB: Case ' || c.case_no || ' is on the agenda of the Medical Board sitting on '
    || to_char(s.sitting_date, 'FMDay FMDD FMMonth YYYY') || '.');
  return jsonb_build_object('sitting_date', s.sitting_date, 'serial', v_serial);
end $$;

create or replace function public.set_sitting_held(p_sitting uuid, p_held boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role('secretariat');
  if not p_held and exists (select 1 from public.cases where sitting_id = p_sitting and decision is not null) then
    raise exception 'Decisions have been entered for this sitting';
  end if;
  update public.sittings set held = p_held, held_at = case when p_held then now() end where id = p_sitting;
  perform public.log_event(null, 'sitting', case when p_held then 'Sitting marked as held' else 'Sitting reopened' end, jsonb_build_object('sitting', p_sitting));
end $$;

create or replace function public.update_sitting(p_sitting uuid, p_venue text, p_attendance text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role('secretariat');
  update public.sittings set venue = coalesce(nullif(trim(p_venue), ''), venue), attendance = coalesce(p_attendance, attendance) where id = p_sitting;
end $$;

create or replace function public.enter_decision(p_case uuid, p_decision public.board_decision) returns bigint
language plpgsql security definer set search_path = public as $$
declare c public.cases; s public.sittings; v_minute text; v_next public.case_stage; v_prev jsonb;
begin
  perform public.require_role('secretariat');
  select * into c from public.cases where id = p_case for update;
  if c.stage <> 'ready' then raise exception 'The case is not on an agenda'; end if;
  select * into s from public.sittings where id = c.sitting_id;
  if not s.held then raise exception 'Mark the sitting as held before entering decisions'; end if;
  v_prev := jsonb_build_object('stage', c.stage, 'stage_entered_at', c.stage_entered_at, 'sitting_id', c.sitting_id,
    'agenda_serial', c.agenda_serial, 'decision', c.decision, 'minute_no', c.minute_no, 'decided_at', c.decided_at);
  v_minute := public.minute_number(s.sitting_date, c.agenda_serial);
  v_next := case p_decision when 'approved' then 'decided' when 'deferred' then 'review' else 'closed' end;
  update public.cases set decision = p_decision, minute_no = v_minute, decided_at = now(),
    sitting_id = case when p_decision = 'deferred' then null else sitting_id end,
    agenda_serial = case when p_decision = 'deferred' then null else agenda_serial end
  where id = p_case;
  perform public.set_stage(p_case, v_next);
  perform public.queue_sms(p_case, 'decision', 'UMB: The Medical Board has considered case ' || c.case_no
    || '. Please contact the Medical Board Registry, Ministry of Health, for the outcome.');
  return public.log_event(p_case, 'decision', 'Board decision entered: ' || replace(p_decision::text, '_', ' ') || ' (' || v_minute || ')',
    jsonb_build_object('prev', v_prev, 'minute', v_minute), true);
end $$;

-- Letters ------------------------------------------------------------------------------------
create or replace function public.draft_letters(p_case uuid) returns int
language plpgsql security definer set search_path = public as $$
declare c public.cases; e public.employers; v_to text; v_tc boolean := false; v_n int := 0; v_sort int := 0;
  r record;
begin
  perform public.require_role('secretariat');
  select * into c from public.cases where id = p_case for update;
  if c.stage <> 'decided' or c.decision <> 'approved' then raise exception 'Letters are drafted for approved cases'; end if;
  create temp table if not exists _plan (kind public.letter_kind, title text, addressee text, tc boolean, signer public.signatory, ref text, receipt boolean) on commit drop;
  truncate _plan;
  if c.type = 'retirement' then
    select * into e from public.employers where id = c.employer_id;
    if e.cadre = 'police' then v_to := 'The Inspector General of Police';
    elsif coalesce(e.head_title, '') <> '' then v_to := e.head_title;
    else v_to := replace(coalesce(public.setting('retirement_addressee') #>> '{}', 'The Head, {employer}'), '{employer}', coalesce(e.name, 'employer'));
         v_tc := (select to_confirm from public.settings where key = 'retirement_addressee'); end if;
    insert into _plan values ('retire', 'Retirement on medical grounds', v_to, v_tc, 'dghs', 'ADM 85/265/01', true);
  elsif c.funding = 'family' then
    insert into _plan values ('intro', 'Letter introducing the patient', coalesce(c.receiving_doctor, 'The receiving doctor'), false, 'dghs', 'ADM 85/265/01', true);
  else
    if c.funding = 'judiciary' then v_to := 'The Chief Justice';
    elsif c.funding = 'parliament' then v_to := 'The Clerk to Parliament';
    else v_to := coalesce(public.setting('opm_addressee') #>> '{}', 'The Permanent Secretary, Office of the Prime Minister');
         v_tc := (select to_confirm from public.settings where key = 'opm_addressee'); end if;
    insert into _plan values
      ('funder', 'Permission to travel and buy foreign exchange', v_to, v_tc, 'minister', 'ADM 85/124/01', true),
      ('extract', 'Minutes extract', 'Enclosed with the Minister''s letter', false, 'board', 'Minute ' || c.minute_no, false),
      ('intro', 'Letter introducing the patient', coalesce(c.receiving_doctor, 'The receiving doctor'), false, 'dghs', 'ADM 85/265/01', true);
  end if;
  for r in select * from _plan loop
    v_sort := v_sort + 1;
    if exists (select 1 from public.letters where case_id = p_case and kind = r.kind) then
      update public.letters set addressee = r.addressee, addressee_to_confirm = r.tc, status = case when status = 'returned' then 'draft' else status end,
        ref_no = r.ref, sort = v_sort where case_id = p_case and kind = r.kind and status in ('draft', 'returned');
    else
      insert into public.letters (case_id, kind, title, addressee, addressee_to_confirm, signer, ref_no, receipt_needed, sort)
      values (p_case, r.kind, r.title, r.addressee, r.tc, r.signer, r.ref, r.receipt, v_sort);
      v_n := v_n + 1;
    end if;
  end loop;
  perform public.log_event(p_case, 'letters_drafted', 'Letters drafted from the templates');
  return v_n;
end $$;

create or replace function public.send_for_signature(p_cases uuid[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_done uuid[] := '{}'; c public.cases;
begin
  perform public.require_role('secretariat');
  foreach v_id in array p_cases loop
    select * into c from public.cases where id = v_id for update;
    if c.stage <> 'decided' or not exists (select 1 from public.letters where case_id = v_id) then continue; end if;
    update public.letters set status = 'awaiting', sent_at = now(), return_note = null where case_id = v_id and kind <> 'extract' and status in ('draft', 'returned');
    update public.letters set status = 'signed', signed_at = now() where case_id = v_id and kind = 'extract' and status <> 'signed';
    perform public.set_stage(v_id, 'signature');
    perform public.log_event(v_id, 'stage', 'Letters sent for signature');
    v_done := v_done || v_id;
  end loop;
  if cardinality(v_done) = 0 then raise exception 'No drafted letters to send'; end if;
  return public.log_event(case when cardinality(v_done) = 1 then v_done[1] end, 'batch_send',
    cardinality(v_done) || ' case(s) sent for signature', jsonb_build_object('cases', to_jsonb(v_done)), true);
end $$;

create or replace function public.mark_letter_signed(p_letter uuid, p_scan_path text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare l public.letters; c public.cases; v_moved boolean := false;
begin
  perform public.require_role('secretariat');
  select * into l from public.letters where id = p_letter for update;
  select * into c from public.cases where id = l.case_id for update;
  if l.status <> 'awaiting' then raise exception 'The letter is not out for signature'; end if;
  update public.letters set status = 'signed', signed_at = now(), signed_scan_path = coalesce(p_scan_path, signed_scan_path) where id = p_letter;
  if not exists (select 1 from public.letters where case_id = l.case_id and status <> 'signed') then
    perform public.set_stage(l.case_id, 'signed'); v_moved := true;
    perform public.queue_sms(l.case_id, 'ready_collection', 'UMB: Letters for case ' || c.case_no
      || ' are ready for collection at the Medical Board Registry, Ministry of Health. Bring an ID.');
  end if;
  return public.log_event(l.case_id, 'letter_signed', 'Marked signed: ' || l.title,
    jsonb_build_object('letter', p_letter, 'prev_stage', c.stage, 'prev_stage_at', c.stage_entered_at, 'moved', v_moved), true);
end $$;

create or replace function public.attach_signed_scan(p_letter uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare l public.letters;
begin
  perform public.require_role('secretariat');
  update public.letters set signed_scan_path = p_path where id = p_letter returning * into l;
  perform public.log_event(l.case_id, 'signed_scan', 'Signed copy scanned: ' || l.title);
end $$;

create or replace function public.return_letter(p_letter uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare l public.letters;
begin
  perform public.require_role('secretariat');
  if coalesce(trim(p_note), '') = '' then raise exception 'Say what needs correcting'; end if;
  select * into l from public.letters where id = p_letter for update;
  if l.status <> 'awaiting' then raise exception 'The letter is not out for signature'; end if;
  update public.letters set status = 'returned', return_note = p_note where id = p_letter;
  update public.letters set status = 'draft' where case_id = l.case_id and status = 'awaiting';
  perform public.set_stage(l.case_id, 'decided');
  perform public.log_event(l.case_id, 'letter_returned', 'Returned for correction: ' || l.title || '. ' || p_note);
end $$;

-- Collection -----------------------------------------------------------------------------------
create or replace function public.issue_collection_code(p_case uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cases; v_code text;
begin
  perform public.require_role('registry');
  select * into c from public.cases where id = p_case;
  if c.stage <> 'signed' then raise exception 'Letters are not ready for collection'; end if;
  if not c.sms_consent or coalesce(c.phone, '') = '' then
    return jsonb_build_object('sent', false, 'reason', 'No consent to SMS or no phone on file. Check the collector''s ID and record the reason.');
  end if;
  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000))::text, 6, '0');
  update public.collection_codes set expires_at = least(expires_at, now()) where case_id = p_case and used_at is null;
  insert into public.collection_codes (case_id, code_hash, phone, expires_at)
  values (p_case, extensions.crypt(v_code, extensions.gen_salt('bf')), c.phone, now() + interval '15 minutes');
  perform public.queue_sms(p_case, 'collection_code', 'UMB: Your code to collect the letters for case ' || c.case_no || ' is ' || v_code
    || '. It expires in 15 minutes. Read it out only to the Registry officer.');
  perform public.log_event(p_case, 'collection_code', 'Collection code sent by SMS to ' || overlay(c.phone placing '****' from greatest(length(c.phone) - 6, 1) for 4));
  return jsonb_build_object('sent', true, 'phone', overlay(c.phone placing '****' from greatest(length(c.phone) - 6, 1) for 4));
end $$;

create or replace function public.record_collection(p_case uuid, p_code text, p_name text, p_relationship text, p_phone text,
  p_id_checked boolean, p_override_reason text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare c public.cases; k public.collection_codes; v_audit bigint;
begin
  perform public.require_role('registry');
  select * into c from public.cases where id = p_case for update;
  if c.stage <> 'signed' then raise exception 'Letters are not ready for collection'; end if;
  if not p_id_checked then raise exception 'Check the collector''s ID first'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_relationship), '') = '' then raise exception 'Enter the collector''s name and relationship'; end if;
  if c.sms_consent and coalesce(c.phone, '') <> '' then
    select * into k from public.collection_codes where case_id = p_case and used_at is null order by created_at desc limit 1 for update;
    if k.id is null then raise exception 'Send a collection code first'; end if;
    if k.expires_at < now() then raise exception 'The code has expired; send a new one'; end if;
    if k.attempts >= 5 then raise exception 'Too many attempts; send a new code'; end if;
    if k.code_hash <> extensions.crypt(coalesce(p_code, ''), k.code_hash) then
      update public.collection_codes set attempts = attempts + 1 where id = k.id;
      perform public.log_event(p_case, 'collection_code_wrong', 'Wrong collection code entered (' || (k.attempts + 1) || ' of 5)');
      return -1;
    end if;
    update public.collection_codes set used_at = now() where id = k.id;
  elsif coalesce(trim(p_override_reason), '') = '' then
    raise exception 'No SMS consent: record why the collection is being made without a code';
  end if;
  insert into public.collections (case_id, collector_name, relationship, phone, id_checked, recorded_by)
  values (p_case, trim(p_name), trim(p_relationship), p_phone, p_id_checked, auth.uid());
  perform public.set_stage(p_case, 'collected');
  v_audit := public.log_event(p_case, 'collection', 'Letters collected by ' || trim(p_name) || ' (' || trim(p_relationship) || ')'
    || coalesce('. Without code: ' || p_override_reason, ''), jsonb_build_object('prev_stage_at', c.stage_entered_at), true);
  perform public.maybe_close(p_case);
  return v_audit;
end $$;

create or replace function public.maybe_close(p_case uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.cases where id = p_case and stage = 'collected')
     and not exists (select 1 from public.letters where case_id = p_case and receipt_needed and not receipt_confirmed) then
    perform public.set_stage(p_case, 'closed');
    perform public.log_event(p_case, 'stage', 'Closed: every receiving office has confirmed receipt');
    return true;
  end if;
  return false;
end $$;
revoke execute on function public.maybe_close(uuid) from public, anon, authenticated;

-- Public verification (anon): minimum fields only, no health information.
create or replace function public.verify_lookup(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('title', l.title, 'addressee', l.addressee, 'date', to_char(coalesce(l.signed_at, l.created_at), 'FMDD FMMonth YYYY'),
    'signed', l.status = 'signed', 'receipt_confirmed', l.receipt_confirmed, 'receipt_needed', l.receipt_needed)
  from public.letters l where l.verify_code = p_code and l.kind <> 'extract'
$$;

-- Called only by the /api/verify route (service role) after captcha and rate-limit checks.
create or replace function public.confirm_receipt_public(p_code text, p_name text, p_designation text) returns boolean
language plpgsql security definer set search_path = public as $$
declare l public.letters;
begin
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_designation), '') = '' then raise exception 'Enter your name and designation'; end if;
  select * into l from public.letters where verify_code = p_code for update;
  if l.id is null or l.status <> 'signed' then return false; end if;
  if l.receipt_confirmed then return true; end if;
  update public.letters set receipt_confirmed = true, receipt_method = 'qr', receipt_by = left(trim(p_name), 120),
    receipt_designation = left(trim(p_designation), 160), receipt_at = now() where id = l.id;
  insert into public.audit_log (case_id, actor_label, action, summary, detail)
  values (l.case_id, 'Receiving office (QR)', 'receipt_confirmed', 'Receipt confirmed by QR code: ' || l.title || ' (' || trim(p_name) || ', ' || trim(p_designation) || ')',
    jsonb_build_object('letter', l.id));
  perform public.maybe_close(l.case_id);
  return true;
end $$;
revoke execute on function public.confirm_receipt_public(text, text, text) from public, anon, authenticated;

create or replace function public.confirm_receipt_stamped(p_letter uuid, p_path text, p_by text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare l public.letters; c public.cases; v_audit bigint;
begin
  perform public.require_role('registry');
  select * into l from public.letters where id = p_letter for update;
  select * into c from public.cases where id = l.case_id;
  if c.stage not in ('collected', 'closed') then raise exception 'Record the collection first'; end if;
  if p_path not like l.case_id || '/' || l.id || '/%' then raise exception 'Scan path does not match the letter'; end if;
  update public.letters set receipt_confirmed = true, receipt_method = 'stamped', stamped_scan_path = p_path, receipt_by = p_by, receipt_at = now()
  where id = p_letter;
  v_audit := public.log_event(l.case_id, 'receipt_confirmed', 'Receipt confirmed by stamped copy: ' || l.title,
    jsonb_build_object('letter', p_letter, 'prev_stage', c.stage, 'prev_stage_at', c.stage_entered_at), true);
  perform public.maybe_close(l.case_id);
  return v_audit;
end $$;

create or replace function public.send_reminder(p_letter uuid, p_contact text default null) returns void
language plpgsql security definer set search_path = public as $$
declare l public.letters; c public.cases; v_to text;
begin
  perform public.require_role('registry', 'secretariat');
  select * into l from public.letters where id = p_letter;
  select * into c from public.cases where id = l.case_id;
  v_to := coalesce(nullif(trim(p_contact), ''), l.office_contact);
  if v_to is null then raise exception 'Enter the receiving office''s phone or email'; end if;
  update public.letters set office_contact = v_to, last_reminder_at = now() where id = p_letter;
  if v_to !~ '@' then
    insert into public.sms_outbox (case_id, to_phone, body, kind) values (l.case_id, v_to,
      'Ministry of Health, Uganda Medical Board: please confirm receipt of letter ' || l.ref_no || ' (' || l.title
      || ') by scanning its QR code, or reply to the Medical Board Registry.', 'reminder');
  end if;
  perform public.log_event(l.case_id, 'reminder', 'Receipt reminder sent to ' || v_to || ' for ' || l.title);
end $$;

-- Notes and mentions ----------------------------------------------------------------------------
create or replace function public.add_note(p_case uuid, p_body text, p_tag_role public.app_role default null, p_tag_user uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_role('registry', 'secretariat');  -- the Commissioner is read-only
  if coalesce(trim(p_body), '') = '' then raise exception 'Write the note first'; end if;
  insert into public.notes (case_id, body, tag_role, tag_user, created_by) values (p_case, trim(p_body), p_tag_role, p_tag_user, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.missing_slip(p_case uuid, p_send boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cases; s public.sittings; v_list text[];
begin
  perform public.require_role('registry', 'secretariat');
  select * into c from public.cases where id = p_case;
  select array_agg(name order by sort) into v_list from public.case_documents where case_id = p_case and status = 'not_brought';
  s := public.next_open_sitting();
  if p_send then
    if public.queue_sms(p_case, 'missing_slip', 'UMB: For case ' || c.case_no || ' please bring: ' || array_to_string(v_list, '; ')
         || '. Next sitting ' || to_char(s.sitting_date, 'FMDD FMMon YYYY') || '; bring them by ' || to_char(s.cutoff_date, 'FMDD FMMon YYYY') || '.') is null then
      raise exception 'No SMS consent or phone on file';
    end if;
    perform public.log_event(p_case, 'missing_slip', 'Missing-documents slip sent by SMS');
  end if;
  return jsonb_build_object('items', coalesce(to_jsonb(v_list), '[]'), 'sitting_date', s.sitting_date, 'cutoff_date', s.cutoff_date, 'phone', c.phone);
end $$;

create or replace function public.set_treatment_return(p_case uuid, p_returned date default null, p_report_received boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role('secretariat', 'registry');
  update public.cases set returned_on = coalesce(p_returned, returned_on),
    report_due = coalesce(p_returned, returned_on) + coalesce((public.setting('report_due_days') #>> '{}')::int, 30),
    report_received_at = case when p_report_received then now() else report_received_at end
  where id = p_case and type = 'referral';
  perform public.log_event(p_case, 'follow_up', case when p_report_received then 'Treatment report received' else 'Return from treatment recorded' end);
end $$;

-- Undo (10-second window; reversible event, nothing is deleted) -------------------------------------
create or replace function public.undo_event(p_audit bigint) returns void
language plpgsql security definer set search_path = public as $$
declare a public.audit_log; p jsonb; v_id uuid; v_letter public.letters;
begin
  select * into a from public.audit_log where id = p_audit;
  if a.id is null or not a.undoable then raise exception 'This action cannot be undone'; end if;
  if a.actor is distinct from auth.uid() then raise exception 'Only the person who did this can undo it'; end if;
  if a.created_at < now() - interval '20 seconds' then raise exception 'The undo window has passed'; end if;
  if exists (select 1 from public.audit_log where reverses = p_audit) then raise exception 'Already undone'; end if;

  if a.action = 'decision' then
    p := a.detail -> 'prev';
    update public.cases set stage = (p ->> 'stage')::public.case_stage, stage_entered_at = (p ->> 'stage_entered_at')::timestamptz,
      sitting_id = (p ->> 'sitting_id')::uuid, agenda_serial = (p ->> 'agenda_serial')::int, decision = null, minute_no = null, decided_at = null
    where id = a.case_id;
  elsif a.action = 'letter_signed' then
    update public.letters set status = 'awaiting', signed_at = null where id = (a.detail ->> 'letter')::uuid;
    if (a.detail ->> 'moved')::boolean then
      update public.cases set stage = (a.detail ->> 'prev_stage')::public.case_stage, stage_entered_at = (a.detail ->> 'prev_stage_at')::timestamptz where id = a.case_id;
      update public.sms_outbox set status = 'failed', last_error = 'Cancelled by undo' where case_id = a.case_id and kind = 'ready_collection' and status = 'queued';
    end if;
  elsif a.action = 'receipt_confirmed' then
    update public.letters set receipt_confirmed = false, receipt_method = null, stamped_scan_path = null, receipt_by = null, receipt_at = null
    where id = (a.detail ->> 'letter')::uuid;
    update public.cases set stage = (a.detail ->> 'prev_stage')::public.case_stage, stage_entered_at = (a.detail ->> 'prev_stage_at')::timestamptz where id = a.case_id;
  elsif a.action = 'collection' then
    update public.collections set reversed = true where case_id = a.case_id and not reversed;
    update public.cases set stage = 'signed', stage_entered_at = (a.detail ->> 'prev_stage_at')::timestamptz where id = a.case_id;
  elsif a.action = 'batch_send' then
    for v_id in select (jsonb_array_elements_text(a.detail -> 'cases'))::uuid loop
      if exists (select 1 from public.letters where case_id = v_id and kind <> 'extract' and status = 'signed') then continue; end if;
      update public.letters set status = 'draft', sent_at = null, signed_at = null where case_id = v_id;
      perform public.set_stage(v_id, 'decided');
    end loop;
  else
    raise exception 'This action cannot be undone';
  end if;
  perform public.log_event(a.case_id, 'undo', 'Undone: ' || a.summary, jsonb_build_object('reverses', p_audit), false, p_audit);
end $$;

-- Admin -------------------------------------------------------------------------------------------
create or replace function public.set_user_role(p_user uuid, p_role public.app_role, p_active boolean default true, p_name text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role('admin');
  if p_user = auth.uid() and (p_role <> 'admin' or not p_active) then raise exception 'You cannot remove your own admin access'; end if;
  update public.profiles set role = p_role, active = p_active, full_name = coalesce(nullif(trim(p_name), ''), full_name) where id = p_user;
  perform public.log_event(null, 'user_role', 'User ' || (select email from public.profiles where id = p_user) || ' set to ' || p_role
    || case when p_active then '' else ' (deactivated)' end);
end $$;

create or replace function public.update_setting(p_key text, p_value jsonb, p_to_confirm boolean default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role('admin');
  update public.settings set value = p_value, to_confirm = coalesce(p_to_confirm, to_confirm), updated_at = now() where key = p_key;
  if not found then raise exception 'Unknown setting %', p_key; end if;
  perform public.log_event(null, 'setting', 'Setting changed: ' || p_key, jsonb_build_object('value', p_value));
  if p_key in ('agenda_cutoff_days') then
    update public.sittings set cutoff_date = sitting_date - (p_value #>> '{}')::int where not held;
  end if;
end $$;

-- Retention: flags cases past the retention period for review (scheduled daily).
create or replace function public.flag_retention() returns int
language plpgsql security definer set search_path = public as $$
declare v_years int := coalesce((public.setting('retention_years') #>> '{}')::int, 10); v_n int;
begin
  update public.cases set retention_flagged_at = now()
  where retention_flagged_at is null and stage = 'closed' and updated_at < now() - make_interval(years => v_years);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Profile row for every new auth user (no role until an admin assigns one).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name) values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Internal helpers are not callable by clients.
revoke execute on function public.log_event(uuid, text, text, jsonb, boolean, bigint) from public, anon, authenticated;
revoke execute on function public.queue_sms(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.upsert_flag(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.refresh_flags(uuid) from public, anon, authenticated;
revoke execute on function public.flag_retention() from public, anon, authenticated;
revoke execute on function public.ensure_sittings(int) from public, anon;
revoke execute on function public.next_open_sitting() from public, anon;
