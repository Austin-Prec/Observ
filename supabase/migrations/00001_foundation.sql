-- ============================================================================
-- 00001_foundation.sql
-- Multi-tenant foundation: organizations, users, roles, membership.
--
-- Design notes:
-- - "Organization" = tenant. Every domain table carries organization_id and
--   is isolated via RLS keyed off that column.
-- - Roles are per-membership (a user can belong to multiple orgs with
--   different roles in each), not a global attribute on the user.
-- - We deliberately do NOT use a boolean `is_active` flag anywhere in the
--   RLS-relevant path. That pattern caused a real production lockout bug
--   in a prior system (71 policies silently excluded rows when a flag
--   defaulted differently than every policy assumed). Instead we use a
--   `status` enum with an explicit default, and policies check status
--   with a named function so there is exactly one place to fix if the
--   semantics ever change.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

create type membership_status as enum ('active', 'suspended', 'invited');

create type org_role as enum (
  'administrator',  -- full control within the org
  'manager',        -- manages projects, frameworks, users below them
  'analyst',        -- read/write on data + analysis, no user/framework admin
  'data_collector',  -- enumerator: can submit data, limited read
  'viewer'          -- read-only
);

-- ----------------------------------------------------------------------------
-- Organizations (tenants)
-- ----------------------------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft-delete via status, not a boolean, for the reason noted above.
  status text not null default 'active' check (status in ('active', 'archived')),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9-]+$')
);

comment on table organizations is 'Tenant root. Every domain row belongs to exactly one organization.';

-- ----------------------------------------------------------------------------
-- Profiles (extends auth.users with app-level fields)
-- Supabase auth.users is managed by the auth schema; we keep app-specific
-- fields in a separate profile table, 1:1 with auth.users.
-- ----------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table profiles is 'App-level profile data, 1:1 with auth.users.';

-- Auto-create a profile row whenever a new auth user is created.
create function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- Memberships: the join table that grants a user a role within an org.
-- This is the single source of truth for "who can do what, where."
-- ----------------------------------------------------------------------------

create table memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role org_role not null,
  status membership_status not null default 'active',
  invited_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

comment on table memberships is 'Grants a user a role within an organization. RLS everywhere else keys off this table.';

create index idx_memberships_org on memberships(organization_id);
create index idx_memberships_user on memberships(user_id);

-- ----------------------------------------------------------------------------
-- Helper functions used throughout RLS policies.
--
-- These are SECURITY DEFINER and STABLE so they can be safely used inside
-- policy expressions without recursive RLS evaluation problems, and so
-- there is exactly ONE place that defines "does this user have access,
-- and at what role" -- not one ad hoc EXISTS(...) per policy, which is
-- how the enumerated-column class of bug creeps in.
-- ----------------------------------------------------------------------------

-- Returns the caller's role in the given org, or null if no active membership.
create function auth_role_in_org(target_org uuid)
returns org_role
language sql
security definer
stable
set search_path = public
as $$
  select role
  from memberships
  where organization_id = target_org
    and user_id = auth.uid()
    and status = 'active'
  limit 1;
$$;

comment on function auth_role_in_org is 'Single source of truth for "what role does the current user have in this org". All RLS policies should call this rather than re-implementing the EXISTS check.';

-- Returns true if the caller has ANY active membership in the org.
create function auth_is_member_of_org(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where organization_id = target_org
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

-- Returns true if the caller's role in the org is administrator or manager.
-- Centralizing "who can administer" here means if the role hierarchy
-- changes later, it changes in one function, not N policies.
--
-- coalesce(..., false) matters here, not just style: auth_role_in_org
-- returns NULL for a caller with no membership in target_org at all, and
-- `NULL in (...)` is NULL under SQL's three-valued logic, not false.
-- Postgres RLS treats a NULL USING/WITH CHECK result as deny, so RLS
-- policies calling this function were never at risk -- but a later
-- caller used this function inside a plpgsql `if not ... then`, where
-- `if NULL then` silently skips the branch rather than being treated as
-- true. That produced a real, confirmed privilege-escalation bug (see
-- migration 00004's publish_form). Fixing it here, at the source, means
-- every future caller of this function is protected automatically,
-- rather than requiring every call site to remember to coalesce it
-- individually the way migration 00004 now does as a second, defense-
-- in-depth measure.
create function auth_can_manage_org(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(auth_role_in_org(target_org) in ('administrator', 'manager'), false);
$$;

-- Returns true if the caller's role in the org is administrator only.
-- Same coalesce rationale as auth_can_manage_org above.
create function auth_is_org_admin(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(auth_role_in_org(target_org) = 'administrator', false);
$$;

-- ----------------------------------------------------------------------------
-- updated_at maintenance trigger (reused by every table going forward)
-- ----------------------------------------------------------------------------

create function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_organizations_updated_at
  before update on organizations
  for each row execute function set_updated_at();

create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

create trigger trg_memberships_updated_at
  before update on memberships
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;

-- Organizations: visible to members only. Creation is open (any
-- authenticated user can create an org, becoming its first admin via the
-- app-layer signup flow + a matching membership insert in the same
-- transaction -- see 00002).
drop policy if exists org_select_members on organizations;
create policy org_select_members on organizations
  for select
  using (auth_is_member_of_org(id));

drop policy if exists org_update_admins on organizations;
create policy org_update_admins on organizations
  for update
  using (auth_is_org_admin(id))
  with check (auth_is_org_admin(id));

-- Profiles: a user can always read their own profile. Org members can read
-- profiles of other members in a shared org (needed for "who submitted
-- this record" UI, user pickers, etc).
drop policy if exists profiles_select_self on profiles;
create policy profiles_select_self on profiles
  for select
  using (id = auth.uid());

drop policy if exists profiles_select_org_members on profiles;
create policy profiles_select_org_members on profiles
  for select
  using (
    exists (
      select 1 from memberships m1
      join memberships m2 on m1.organization_id = m2.organization_id
      where m1.user_id = auth.uid()
        and m1.status = 'active'
        and m2.user_id = profiles.id
        and m2.status = 'active'
    )
  );

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Memberships: members can see other memberships within orgs they belong
-- to (needed for team/user-management screens). Only admins/managers can
-- insert or update memberships (invite/change role); only admins can
-- delete (remove a user).
drop policy if exists memberships_select_org_members on memberships;
create policy memberships_select_org_members on memberships
  for select
  using (auth_is_member_of_org(organization_id));

drop policy if exists memberships_insert_managers on memberships;
create policy memberships_insert_managers on memberships
  for insert
  with check (auth_can_manage_org(organization_id));

drop policy if exists memberships_update_managers on memberships;
create policy memberships_update_managers on memberships
  for update
  using (auth_can_manage_org(organization_id))
  with check (auth_can_manage_org(organization_id));

drop policy if exists memberships_delete_admins on memberships;
create policy memberships_delete_admins on memberships
  for delete
  using (auth_is_org_admin(organization_id));

-- Grants: RLS restricts rows, but the `authenticated` role still needs
-- baseline table privileges or every query fails before RLS is even
-- evaluated. This exact gap (72 tables missing grants) was a real bug
-- found in a prior audit, so it's handled explicitly and up front here.
grant usage on schema public to authenticated;
grant select, insert, update, delete on organizations to authenticated;
grant select, update on profiles to authenticated;
grant select, insert, update, delete on memberships to authenticated;
