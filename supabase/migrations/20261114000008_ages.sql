-- Ages in years, months, weeks and days (infants and young children).
create or replace function public.age_label(p_dob date, p_on date default current_date) returns text
language sql immutable as $$
  select case
    when age(p_on, p_dob) >= interval '2 years' then extract(year from age(p_on, p_dob))::int || ' years'
    when age(p_on, p_dob) >= interval '1 month' then (extract(year from age(p_on, p_dob)) * 12 + extract(month from age(p_on, p_dob)))::int || ' months'
    when p_on - p_dob >= 7 then ((p_on - p_dob) / 7) || ' weeks'
    else (p_on - p_dob) || ' days' end
$$;

-- A stated age matches the date of birth in whatever unit it was written ("54", "6 months", "3 weeks", "10 days").
create or replace function public.stated_age_matches(p_stated text, p_dob date, p_on date default current_date) returns boolean
language plpgsql immutable as $$
declare n numeric := public.digits_amount(p_stated); a interval := age(p_on, p_dob); total_months int;
begin
  if n is null then return true; end if;
  total_months := (extract(year from a) * 12 + extract(month from a))::int;
  if p_stated ~* 'month' then return abs(n - total_months) <= 0; end if;
  if p_stated ~* 'week' then return abs(n - (p_on - p_dob) / 7) <= 1; end if;
  if p_stated ~* 'day' then return abs(n - (p_on - p_dob)) <= 1; end if;
  return n = extract(year from a)::int;
end $$;

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
    if not public.stated_age_matches(v_x, c.dob) then
      v_active := v_active || 'age_mismatch'::text;
      perform public.upsert_flag(p_case, 'age_mismatch', 'Stated age ' || v_x || ' does not match the age from the date of birth ('
        || public.age_label(c.dob) || '). Letters use the age from the date of birth.');
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

