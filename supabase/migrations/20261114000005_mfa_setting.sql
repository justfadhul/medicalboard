-- Two-step verification (TOTP) becomes an admin setting. Off: an emailed sign-in link is enough.
-- On: roles only count on an MFA-verified (aal2) session, enforced here in the database.
insert into public.settings (key, value, label, to_confirm)
values ('mfa_required', 'false', 'Require two-step verification (authenticator app) for every user', true)
on conflict (key) do nothing;

create or replace function public.mfa_required() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from public.settings where key = 'mfa_required'), true)
$$;

create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.active
    and (not public.mfa_required() or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
$$;

-- Lets the app know whether to send a signed-in user to the authenticator screen.
create or replace function public.needs_mfa() returns boolean
language sql stable security definer set search_path = public as $$
  select public.mfa_required() and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
$$;
