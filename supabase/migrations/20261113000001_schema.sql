-- Uganda Medical Board case system: schema
create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('registry', 'secretariat', 'commissioner', 'admin');
create type public.case_type as enum ('retirement', 'referral');
create type public.case_stage as enum ('intake', 'review', 'ready', 'decided', 'signature', 'signed', 'collected', 'closed');
create type public.receipt_status as enum ('received', 'not_brought', 'not_applicable');
create type public.rule_status as enum ('confirmed', 'to_confirm', 'limit_to_set', 'seen_in_past', 'applied_in_practice');
create type public.finding_type as enum ('missing_document', 'missing_information', 'mismatch', 'other');
create type public.finding_effect as enum ('block', 'record');
create type public.board_decision as enum ('approved', 'deferred', 'not_approved');
create type public.letter_kind as enum ('retire', 'intro', 'funder', 'extract');
create type public.letter_status as enum ('draft', 'awaiting', 'signed', 'returned');
create type public.signatory as enum ('dghs', 'minister', 'board');
create type public.funding_source as enum ('family', 'government', 'judiciary', 'parliament');
create type public.cadre as enum ('police', 'teachers', 'health', 'lg', 'all');

-- People -------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.app_role,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Settings and editable lists ---------------------------------------------
create table public.settings (
  key text primary key,
  value jsonb not null,
  label text not null,
  to_confirm boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.employers (
  id serial primary key,
  name text not null unique,
  cadre public.cadre,
  head_title text,           -- addressee of retirement letters
  active boolean not null default true,
  sort int not null default 100
);
create table public.procedures (
  id serial primary key,
  name text not null unique,
  active boolean not null default true,
  sort int not null default 100
);
create table public.countries (
  id serial primary key,
  name text not null unique,
  active boolean not null default true,
  sort int not null default 100
);

create table public.rules (
  id text primary key,
  text text not null,
  applies_to text not null,
  status public.rule_status not null,
  limit_days int,
  updated_at timestamptz not null default now()
);

-- Standard checklist (editable by admins)
create table public.doc_catalog (
  key text primary key,
  name text not null,
  case_type public.case_type,      -- null = transplant add-on
  transplant boolean not null default false,
  rule_id text references public.rules (id),
  can_na boolean not null default false,
  sort int not null
);

create table public.cadre_docs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scope public.cadre not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (name, scope)
);

-- Sittings -------------------------------------------------------------------
create table public.sittings (
  id uuid primary key default gen_random_uuid(),
  sitting_date date not null unique,
  venue text not null,
  cutoff_date date not null,
  held boolean not null default false,
  held_at timestamptz,
  attendance text
);

-- Cases ---------------------------------------------------------------------
create sequence public.case_no_seq start 101;

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  case_no text not null unique,
  type public.case_type not null,
  name text not null,
  gender text not null check (gender in ('Female', 'Male')),
  dob date not null,
  stated_age int,
  phone text,
  sms_consent boolean not null default false,
  -- retirement
  employer_id int references public.employers (id),
  station text,
  -- referral
  funding public.funding_source,
  funding_body text,
  procedure text,
  country text,
  diagnosis text,
  referring_doctor text,
  receiving_doctor text,
  receiving_centre text,
  cost_figures text,
  cost_words text,
  duration text,
  accompanying text,
  earlier_referral boolean not null default false,
  -- workflow
  stage public.case_stage not null default 'intake',
  stage_entered_at timestamptz not null default now(),
  hold boolean not null default false,
  hold_reason text,
  sitting_id uuid references public.sittings (id),
  agenda_serial int,
  decision public.board_decision,
  minute_no text,
  decided_at timestamptz,
  returned_on date,
  report_due date,
  report_received_at timestamptz,
  retention_flagged_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hold_reason_required check (not hold or coalesce(hold_reason, '') <> '')
);
create index cases_stage_idx on public.cases (stage);
create index cases_dup_idx on public.cases (lower(name), dob);

create table public.case_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  catalog_key text references public.doc_catalog (key),
  name text not null,
  source text not null check (source in ('standard', 'transplant', 'cadre', 'custom', 'finding')),
  rule_id text references public.rules (id),
  can_na boolean not null default false,
  status public.receipt_status not null default 'received',
  reason text,
  sort int not null default 100,
  pdf_path text,
  created_at timestamptz not null default now(),
  constraint reason_when_missing check (status <> 'not_brought' or coalesce(reason, '') <> ''),
  constraint na_allowed check (status <> 'not_applicable' or can_na)
);
create index case_documents_case_idx on public.case_documents (case_id);

create table public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.case_documents (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  page_no int not null,
  path text not null,
  width int,
  height int,
  quality_score numeric,
  quality jsonb,
  keep_reason text,
  rotation int not null default 0,
  scanned_by uuid references public.profiles (id),
  scanned_at timestamptz not null default now()
);
create index document_pages_doc_idx on public.document_pages (document_id, page_no);

create table public.case_fields (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  key text not null,
  label text not null,
  value text not null,
  document_id uuid references public.case_documents (id) on delete set null,
  page_no int,
  bbox jsonb,                      -- {x,y,w,h} as fractions of the page
  origin text not null default 'manual' check (origin in ('manual', 'ai')),
  confirmed boolean not null default false,
  confirmed_by uuid references public.profiles (id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index case_fields_case_idx on public.case_fields (case_id);

create table public.flags (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  code text not null,
  text text not null,
  resolved boolean not null default false,
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (case_id, code)
);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  document_id uuid references public.case_documents (id) on delete set null,
  type public.finding_type not null,
  what text not null,
  reasoning text not null default '',
  effect public.finding_effect not null,
  resolved boolean not null default false,
  resolved_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  body text not null,
  tag_role public.app_role,
  tag_user uuid references public.profiles (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create table public.mention_reads (
  note_id uuid references public.notes (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (note_id, user_id)
);

-- Letters ---------------------------------------------------------------------
create table public.letters (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  kind public.letter_kind not null,
  title text not null,
  addressee text not null,
  addressee_to_confirm boolean not null default false,
  signer public.signatory not null,
  ref_no text not null,
  status public.letter_status not null default 'draft',
  return_note text,
  receipt_needed boolean not null default true,
  receipt_confirmed boolean not null default false,
  receipt_method text check (receipt_method in ('qr', 'stamped')),
  receipt_by text,
  receipt_designation text,
  receipt_at timestamptz,
  verify_code text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  signed_scan_path text,
  stamped_scan_path text,
  office_contact text,
  sent_at timestamptz,
  signed_at timestamptz,
  last_reminder_at timestamptz,
  sort int not null default 1,
  created_at timestamptz not null default now()
);
create index letters_case_idx on public.letters (case_id);

-- Collection ------------------------------------------------------------------
create table public.collection_codes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  code_hash text not null,
  phone text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  collector_name text not null,
  relationship text not null,
  phone text,
  id_checked boolean not null,
  recorded_by uuid references public.profiles (id),
  collected_at timestamptz not null default now(),
  reversed boolean not null default false
);

-- Messaging -------------------------------------------------------------------
create table public.sms_outbox (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases (id) on delete set null,
  to_phone text not null,
  body text not null,
  kind text not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text,
  provider text,
  provider_ref text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index sms_outbox_queue_idx on public.sms_outbox (status, next_attempt_at);

-- Scanning --------------------------------------------------------------------
create table public.scan_pairings (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  case_id uuid not null references public.cases (id) on delete cascade,
  document_id uuid references public.case_documents (id) on delete cascade,
  batch boolean not null default false,
  created_by uuid not null references public.profiles (id),
  expires_at timestamptz not null,
  claimed_by uuid references public.profiles (id),
  claimed_at timestamptz
);

-- Saved views -------------------------------------------------------------------
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  name text not null,
  filters jsonb not null,
  created_at timestamptz not null default now()
);

-- AI reading log ----------------------------------------------------------------
create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases (id) on delete set null,
  document_id uuid references public.case_documents (id) on delete set null,
  pages int[] not null,
  model text not null,
  status text not null,
  error text,
  requested_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Verify page rate limiting ---------------------------------------------------
create table public.verify_hits (
  id bigserial primary key,
  ip_hash text not null,
  at timestamptz not null default now()
);
create index verify_hits_idx on public.verify_hits (ip_hash, at);

-- Audit log (append-only) ------------------------------------------------------
create table public.audit_log (
  id bigserial primary key,
  case_id uuid references public.cases (id) on delete set null,
  actor uuid,
  actor_label text,
  action text not null,
  summary text not null,
  detail jsonb not null default '{}',
  undoable boolean not null default false,
  reverses bigint references public.audit_log (id),
  created_at timestamptz not null default now()
);
create index audit_case_idx on public.audit_log (case_id, created_at);

create or replace function public.audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_no_update before update or delete on public.audit_log
  for each row execute function public.audit_append_only();
