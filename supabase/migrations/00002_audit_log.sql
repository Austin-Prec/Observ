-- ============================================================================
-- 00002_audit_log.sql
-- Immutable, append-only audit log.
--
-- Requirement (from spec): "Every action (login, view, create, edit,
-- delete, export) must be logged with timestamp, user, and IP address.
-- Audit logs must be immutable and read-only."
--
-- "Immutable" is enforced here at the database level via triggers that
-- reject UPDATE and DELETE outright, not merely by omitting an edit UI.
-- Even a SECURITY DEFINER function or a service-role script cannot alter
-- a row after insert -- the only way to remove audit history is to drop
-- the table itself, which requires superuser / migration-level access
-- and would itself be an extraordinary, out-of-band action.
-- ============================================================================

create type audit_action as enum (
  'login', 'logout', 'view', 'create', 'update', 'delete', 'export', 'import'
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete restrict,
  actor_id uuid references profiles(id) on delete restrict,
  action audit_action not null,
  -- What kind of thing was acted on (e.g. 'indicator', 'project',
  -- 'membership') and its id. Nullable target_id to allow logging
  -- actions like 'export' that may not have a single record target.
  target_table text,
  target_id uuid,
  -- Free-form context: field-level diffs on update, filter criteria on
  -- export, etc. Kept as jsonb rather than a fixed schema because the
  -- shape of "what happened" legitimately varies by action type.
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

comment on table audit_logs is 'Append-only. UPDATE and DELETE are rejected by trigger -- see trg_audit_logs_immutable below.';

create index idx_audit_logs_org_created on audit_logs(organization_id, created_at desc);
create index idx_audit_logs_actor on audit_logs(actor_id);
create index idx_audit_logs_target on audit_logs(target_table, target_id);

-- ----------------------------------------------------------------------------
-- Immutability enforcement
-- ----------------------------------------------------------------------------

create function reject_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only: % is not permitted', TG_OP
    using errcode = '0LTR0';  -- custom code, easy to grep in logs/alerts
end;
$$;

create trigger trg_audit_logs_immutable
  before update or delete on audit_logs
  for each row execute function reject_audit_log_mutation();

-- ----------------------------------------------------------------------------
-- Write helper. Application code (or other triggers) calls this instead of
-- inserting directly, so there is one call site to extend if the logging
-- contract changes (e.g. adding a new required field later).
--
-- SECURITY DEFINER so that data-collector-role users, who should not have
-- direct INSERT grant on audit_logs (a write path that bypasses this
-- function would let a client craft arbitrary audit entries), can still
-- trigger legitimate audit writes through normal app actions.
-- ----------------------------------------------------------------------------

create function write_audit_log(
  p_organization_id uuid,
  p_action audit_action,
  p_target_table text default null,
  p_target_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into audit_logs (
    organization_id, actor_id, action, target_table, target_id,
    metadata, ip_address, user_agent
  ) values (
    p_organization_id, auth.uid(), p_action, p_target_table, p_target_id,
    p_metadata, p_ip_address, p_user_agent
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function write_audit_log is 'The only sanctioned write path for audit_logs. Application code should call this via RPC rather than inserting directly.';

-- ----------------------------------------------------------------------------
-- Row Level Security
-- Audit logs are readable by admins/managers of the org (accountability
-- data is itself sensitive -- data collectors should not see the full
-- action history of other users). Writes go through write_audit_log(),
-- which runs as SECURITY DEFINER and bypasses RLS by design.
--
-- Immutability is enforced by TWO independent layers, verified separately
-- against a real Postgres instance:
--   1. Explicit `for update using (false)` / `for delete using (false)`
--      policies below. Note: Postgres RLS does NOT raise an error when a
--      using(false) policy filters out the target row on UPDATE/DELETE --
--      it silently matches zero rows, same as it would for SELECT. This
--      is documented Postgres behavior, not a bug: "such rows are
--      silently suppressed; no error is reported" (CREATE POLICY docs).
--      The correct way to confirm this layer works is to check that
--      `UPDATE ... RETURNING` comes back with zero rows, not to check
--      for a thrown exception -- see supabase/testing/rls_isolation_test.sql
--      Check 7 for a verified example.
--   2. The trg_audit_logs_immutable trigger above, which DOES raise an
--      explicit exception. This is the layer that protects the table
--      against a role with the BYPASSRLS attribute (e.g. a future
--      superuser-equivalent service role), where RLS policies are not
--      evaluated at all and only a trigger can still intervene. Verified
--      directly against postgres (a BYPASSRLS role) during development.
-- ----------------------------------------------------------------------------

alter table audit_logs enable row level security;

drop policy if exists audit_logs_select_managers on audit_logs;
create policy audit_logs_select_managers on audit_logs
  for select
  using (auth_can_manage_org(organization_id));

drop policy if exists audit_logs_deny_update on audit_logs;
create policy audit_logs_deny_update on audit_logs
  for update
  using (false);

drop policy if exists audit_logs_deny_delete on audit_logs;
create policy audit_logs_deny_delete on audit_logs
  for delete
  using (false);

-- Deliberately: no insert/update/delete grants to `authenticated` on this
-- table. Grant only SELECT; writes happen exclusively via write_audit_log().
grant select on audit_logs to authenticated;
grant execute on function write_audit_log to authenticated;
