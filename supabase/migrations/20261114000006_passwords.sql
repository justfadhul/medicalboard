-- Password sign-in without emails: each user creates their own password the first time.
alter table public.profiles add column if not exists password_set boolean not null default false;
alter table public.profiles add column if not exists password_set_at timestamptz;

-- Generic rate-limit log for public endpoints (verify page, first-time password).
alter table public.verify_hits add column if not exists bucket text not null default 'verify';
create index if not exists verify_hits_bucket_idx on public.verify_hits (bucket, ip_hash, at);
