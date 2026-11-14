-- Delete every scanned page of a document at once (returns the storage paths so the client removes the files).
create or replace function public.delete_all_pages(p_doc uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare d public.case_documents; v_paths text[];
begin
  select * into d from public.case_documents where id = p_doc;
  if d.id is null then raise exception 'Unknown document'; end if;
  perform public.case_editable_docs(d.case_id);
  select coalesce(array_agg(path), '{}') into v_paths from public.document_pages where document_id = p_doc;
  delete from public.document_pages where document_id = p_doc;
  update public.case_documents set pdf_path = null where id = p_doc;
  perform public.log_event(d.case_id, 'pages_deleted', d.name || ': all ' || cardinality(v_paths) || ' scanned page(s) deleted');
  return case when d.pdf_path is null then v_paths else v_paths || d.pdf_path end;
end $$;
