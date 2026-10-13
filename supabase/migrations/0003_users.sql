-- 0003_users (S02, part 1): DATA_MODEL section 2.1. RLS is enabled in this same file;
-- with no policy yet, the table is fail-closed until 0004 adds the SELECT policy.

create table public.users (
  id             uuid primary key references auth.users (id) on delete restrict,
  name           text not null,
  role           text not null check (role in ('admin', 'sales', 'engineer')),
  deactivated_at timestamptz,
  created_at     timestamptz not null default now(),
  job_title      text
);

comment on table public.users is
  'Staff profile; id equals auth.users.id. Writes only via the admin-users Edge Function (service role).';

alter table public.users enable row level security;

-- Supabase default privileges grant everything to anon/authenticated; take it all back,
-- then give back only what section 10 allows (read). Writes go through the service role.
revoke all on table public.users from public, anon, authenticated;
grant select on table public.users to authenticated;
