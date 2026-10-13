-- TEST-ONLY fixtures. Loaded exclusively by `supabase db reset` (local stack / CI), via
-- [db.seed] in config.toml. It is never part of migrations and never pushed to a remote project.
-- Fixed UUIDs let pgTAP tests impersonate each user through request.jwt.claims.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'admin@test.invalid', extensions.crypt('fixture-only-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'sales@test.invalid', extensions.crypt('fixture-only-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'engineer@test.invalid', extensions.crypt('fixture-only-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'deactivated@test.invalid', extensions.crypt('fixture-only-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.users (id, name, role, job_title, deactivated_at) values
  ('a0000000-0000-4000-8000-000000000001', 'Test Admin',       'admin',    'Director',       null),
  ('a0000000-0000-4000-8000-000000000002', 'Test Sales',       'sales',    'Sales Engineer', null),
  ('a0000000-0000-4000-8000-000000000003', 'Test Engineer',    'engineer', null,             null),
  ('a0000000-0000-4000-8000-000000000004', 'Test Deactivated', 'sales',    null,             '2026-01-01 00:00:00+00');
