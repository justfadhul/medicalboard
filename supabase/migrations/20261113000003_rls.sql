-- Row Level Security on every table. Clients read through RLS; all writes go through the functions above,
-- except the few simple rows noted below.

do $$ declare t text; begin
  foreach t in array array['profiles','settings','employers','procedures','countries','rules','doc_catalog','cadre_docs','sittings','cases',
    'case_documents','document_pages','case_fields','flags','findings','notes','mention_reads','letters','collection_codes','collections',
    'sms_outbox','scan_pairings','saved_views','ai_calls','verify_hits','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Registry may see a case from intake, and again from signing onwards (collection and receipt).
create or replace function public.registry_can_see(p_case uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cases c where c.id = p_case
    and (c.stage in ('intake', 'review', 'signed', 'collected', 'closed') or c.created_by = auth.uid()))
$$;

create or replace function public.can_see_case(p_case uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('secretariat', 'commissioner') or (public.my_role() = 'registry' and public.registry_can_see(p_case))
$$;

-- People and reference data
create policy profiles_read on public.profiles for select using (public.my_role() is not null or id = auth.uid());
create policy settings_read on public.settings for select using (public.my_role() is not null);
create policy employers_read on public.employers for select using (public.my_role() is not null);
create policy procedures_read on public.procedures for select using (public.my_role() is not null);
create policy countries_read on public.countries for select using (public.my_role() is not null);
create policy rules_read on public.rules for select using (public.my_role() is not null);
create policy catalog_read on public.doc_catalog for select using (public.my_role() is not null);
create policy cadre_read on public.cadre_docs for select using (public.my_role() is not null);
create policy sittings_read on public.sittings for select using (public.my_role() is not null);

-- Editable lists: admins (lists, catalog, settings via function); Secretariat and admin (rulebook); cadre mappings removable by Registry/Secretariat.
grant insert, update, delete on public.employers, public.procedures, public.countries, public.doc_catalog to authenticated;
grant usage on all sequences in schema public to authenticated;
create policy employers_admin on public.employers for all using (public.has_role('admin')) with check (public.has_role('admin'));
create policy procedures_admin on public.procedures for all using (public.has_role('admin')) with check (public.has_role('admin'));
create policy countries_admin on public.countries for all using (public.has_role('admin')) with check (public.has_role('admin'));
create policy catalog_admin on public.doc_catalog for all using (public.has_role('admin')) with check (public.has_role('admin'));
grant update on public.rules to authenticated;
create policy rules_edit on public.rules for update using (public.has_role('secretariat')) with check (public.has_role('secretariat'));
grant delete on public.cadre_docs to authenticated;
create policy cadre_delete on public.cadre_docs for delete using (public.has_role('registry', 'secretariat'));

-- Case data
create policy cases_read on public.cases for select using (public.can_see_case(id));
create policy docs_read on public.case_documents for select using (public.can_see_case(case_id));
create policy pages_read on public.document_pages for select using (public.can_see_case(case_id));
create policy fields_read on public.case_fields for select using (public.has_role('secretariat', 'commissioner'));
create policy flags_read on public.flags for select using (public.has_role('secretariat', 'commissioner'));
create policy findings_read on public.findings for select using (public.has_role('secretariat', 'commissioner'));
create policy notes_read on public.notes for select using (public.can_see_case(case_id) or tag_user = auth.uid());
create policy letters_read on public.letters for select using (
  public.has_role('secretariat', 'commissioner')
  or (public.my_role() = 'registry' and exists (select 1 from public.cases c where c.id = case_id and c.stage in ('signed', 'collected', 'closed'))));
create policy collections_read on public.collections for select using (public.can_see_case(case_id));
create policy audit_read on public.audit_log for select using (
  public.has_role('admin') or (case_id is not null and public.can_see_case(case_id)));
create policy sittings_cases on public.ai_calls for select using (public.has_role('admin'));
create policy sms_read on public.sms_outbox for select using (public.has_role('admin'));
-- collection_codes, scan_pairings, verify_hits: no client access at all (no policies).

-- Per-user rows written directly
grant insert, delete on public.mention_reads to authenticated;
create policy reads_own on public.mention_reads for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant insert, update, delete on public.saved_views to authenticated;
create policy views_own on public.saved_views for all using (user_id = auth.uid() and public.my_role() is not null)
  with check (user_id = auth.uid() and public.my_role() is not null);

-- The audit log is append-only even for the service role.
revoke update, delete, truncate on public.audit_log from authenticated, anon, service_role;

-- Function grants: anon may only look up a verification code.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.verify_lookup(text) to anon;

-- Realtime for live scan pages, notes (mentions) and letters.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.document_pages, public.notes, public.cases;
  end if;
end $$;

-- Storage: private buckets only; access through short-lived signed URLs.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit) values
      ('scans', 'scans', false, 15728640), ('letters', 'letters', false, 15728640), ('templates', 'templates', false, 10485760)
    on conflict (id) do update set public = false;

    create policy scans_read on storage.objects for select to authenticated
      using (bucket_id = 'scans' and public.can_see_case((storage.foldername(name))[1]::uuid));
    create policy scans_write on storage.objects for insert to authenticated
      with check (bucket_id = 'scans' and public.has_role('registry', 'secretariat') and public.can_see_case((storage.foldername(name))[1]::uuid));
    create policy scans_update on storage.objects for update to authenticated
      using (bucket_id = 'scans' and public.has_role('registry', 'secretariat'));
    create policy scans_delete on storage.objects for delete to authenticated
      using (bucket_id = 'scans' and public.has_role('registry', 'secretariat'));

    create policy letters_read on storage.objects for select to authenticated
      using (bucket_id = 'letters' and (public.has_role('secretariat', 'commissioner') or public.my_role() = 'registry'));
    create policy letters_write on storage.objects for insert to authenticated
      with check (bucket_id = 'letters' and public.has_role('registry', 'secretariat'));

    create policy templates_read on storage.objects for select to authenticated
      using (bucket_id = 'templates' and public.has_role('secretariat'));
    create policy templates_write on storage.objects for insert to authenticated
      with check (bucket_id = 'templates' and public.has_role('admin'));
    create policy templates_update on storage.objects for update to authenticated
      using (bucket_id = 'templates' and public.has_role('admin'));
    create policy templates_delete on storage.objects for delete to authenticated
      using (bucket_id = 'templates' and public.has_role('admin'));
  end if;
end $$;

-- Scheduled jobs (pg_cron, when the extension is enabled on the project).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('umb-retention', '17 2 * * *', 'select public.flag_retention()');
    perform cron.schedule('umb-sittings', '23 2 1 * *', 'select public.ensure_sittings(12)');
  end if;
end $$;
