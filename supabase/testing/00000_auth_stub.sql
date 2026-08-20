-- ============================================================================
-- Stub of the Supabase-managed `auth` schema, for local RLS testing only.
--
-- In a real Supabase project, `auth.users` and `auth.uid()` are provided
-- by the platform -- this file exists solely so the actual migrations
-- (00001-00003) can run unmodified against vanilla Postgres in this
-- sandbox. auth.uid() reads a per-session config variable
-- (`request.jwt.claim.sub`), which lets a test script simulate "logged in
-- as user X" by literally switching what the current Postgres session
-- believes its authenticated user is -- the same mechanism Supabase's
-- PostgREST layer uses in production, not a mock.
-- ============================================================================

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  -- Real Supabase auth.users has this column; the trigger in migration
  -- 00001 (handle_new_auth_user) reads raw_user_meta_data ->> 'full_name'
  -- when auto-creating a profile row. Omitting it here caused the seed
  -- insert to fail with "record new has no field raw_user_meta_data" --
  -- a real gap in this stub, not in the migration itself, caught only by
  -- actually running the trigger rather than reading it.
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- `authenticated` role is referenced by GRANT statements in the real
-- migrations (Supabase provisions this automatically). Create it here so
-- those GRANT statements run unmodified.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end
$$;
