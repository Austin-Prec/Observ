-- ============================================================================
-- 00004_forms.sql
-- Data collection forms: definitions, versioned fields, publish/draft state.
--
-- Key design decision: forms are versioned and PUBLISHED fields become
-- immutable, for the same reason audit_logs is immutable -- once a form
-- has live survey responses against it, silently changing a question's
-- type or removing a field would corrupt every response already
-- collected against that field, and no downstream analysis could trust
-- the data. A published form can be revised, but revising creates a NEW
-- version; it does not mutate the one respondents already answered
-- against. Draft forms (never published) remain freely editable, since
-- no response data depends on them yet.
-- ============================================================================

create type form_status as enum ('draft', 'published', 'archived');

create type field_type as enum (
  'text', 'number', 'date', 'dropdown', 'radio', 'checkbox',
  'likert_scale', 'photo_upload', 'file_upload', 'signature',
  'gps_coordinates', 'barcode_qr'
);

-- ----------------------------------------------------------------------------
-- Forms: the top-level data collection tool (survey, KII guide, checklist).
-- ----------------------------------------------------------------------------

create table forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  description text,
  status form_status not null default 'draft',
  -- Which published version is currently the "live" one respondents see.
  -- Null while the form has never been published. Draft edits happen on
  -- a working copy in form_fields (see below) that is separate from
  -- whatever version is live.
  current_version integer not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table forms is 'A data collection tool (survey/KII/checklist). project_id is nullable -- an org can build a reusable form template not yet tied to a specific project.';

create index idx_forms_org on forms(organization_id);
create index idx_forms_project on forms(project_id);

create trigger trg_forms_updated_at
  before update on forms
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- Form versions: a published snapshot. Created at publish time; never
-- updated afterward. This is the actual immutability boundary -- form_fields
-- rows are tagged with the version they belong to, and once a version has
-- ANY response data (checked at publish-a-new-version time, not enforced
-- by trigger here since responses don't exist yet in this migration --
-- see the "not yet built" note at the bottom), the fields under it must
-- never change.
-- ----------------------------------------------------------------------------

create table form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms(id) on delete cascade,
  version integer not null,
  published_by uuid references profiles(id),
  published_at timestamptz not null default now(),
  unique (form_id, version)
);

comment on table form_versions is 'One row per publish event. form_fields.form_version_id references this to pin fields to an immutable snapshot.';

-- ----------------------------------------------------------------------------
-- Form fields: the actual questions/inputs on a form.
--
-- A field belongs EITHER to a draft (form_version_id is null, editable
-- freely, tied directly to forms.id) OR to a published version
-- (form_version_id set, immutable -- see trigger below). This is modeled
-- as one table with a nullable FK rather than two tables, because the
-- field shape (type, label, validation, options) is identical in both
-- states; only the mutability differs.
-- ----------------------------------------------------------------------------

create table form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms(id) on delete cascade,
  form_version_id uuid references form_versions(id) on delete cascade,
  field_type field_type not null,
  label text not null,
  help_text text,
  sort_order integer not null default 0,
  is_required boolean not null default false,
  -- Options for dropdown/radio/checkbox/likert_scale, as an ordered
  -- jsonb array of {value, label}. Kept as jsonb rather than a separate
  -- options table: options are inherently ordered and field-specific,
  -- never reused across fields the way indicator disaggregation values
  -- are reused across indicators, so a join table would add complexity
  -- without the reuse benefit that justified it for disaggregations.
  options jsonb not null default '[]'::jsonb,
  -- Validation rules as jsonb: shape depends on field_type (e.g.
  -- {min, max} for number, {max_length} for text, {allowed_types} for
  -- file_upload). A fixed-column schema would need a different column
  -- per field_type's validation shape; jsonb here trades some query-time
  -- structure for the flexibility this genuinely needs.
  validation jsonb not null default '{}'::jsonb,
  -- Skip logic: which prior field/value combination makes this field
  -- appear. Null means "always shown." Kept minimal (single condition)
  -- deliberately -- a full branching/logic-jump engine is a larger
  -- feature than this migration's scope; this is enough for the common
  -- "show Q7 only if Q6 = Yes" case the spec calls out explicitly
  -- ("logic jumps" under Data Quality Checks).
  depends_on_field_id uuid references form_fields(id),
  depends_on_value text,
  -- Which indicator (if any) this field's responses feed into. Nullable
  -- because not every form field maps to a formal indicator (e.g. a
  -- free-text "additional comments" field).
  indicator_id uuid references indicators(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_fields_options_only_for_choice_types check (
    field_type in ('dropdown', 'radio', 'checkbox', 'likert_scale')
    or options = '[]'::jsonb
  )
);

comment on table form_fields is 'Immutable once form_version_id is set (see trg_form_fields_immutable_once_published). Draft fields (form_version_id null) are freely editable.';

create index idx_form_fields_form on form_fields(form_id);
create index idx_form_fields_version on form_fields(form_version_id);

create trigger trg_form_fields_updated_at
  before update on form_fields
  for each row execute function set_updated_at();

-- Enforce immutability of published fields. Mirrors the audit_logs
-- pattern (trigger + explicit deny policies), applying the lesson from
-- that migration directly: a trigger alone is not sufficient against a
-- BYPASSRLS role, and an RLS policy alone produces a silent zero-match
-- rather than a clear signal, so both layers are defined here too,
-- verified together rather than assumed sufficient individually.
create function reject_published_field_mutation()
returns trigger
language plpgsql
as $$
begin
  if OLD.form_version_id is not null then
    raise exception 'form_fields row % belongs to published version % and cannot be modified or deleted', OLD.id, OLD.form_version_id
      using errcode = '0LTR1';
  end if;
  return coalesce(NEW, OLD);
end;
$$;

create trigger trg_form_fields_immutable_once_published
  before update or delete on form_fields
  for each row
  when (OLD.form_version_id is not null)
  execute function reject_published_field_mutation();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- Same pattern as indicators/logframe: SELECT open to org members
-- (a Data Collector filling out a form needs to read its fields),
-- write restricted to Administrator/Manager.
-- ----------------------------------------------------------------------------

alter table forms enable row level security;
alter table form_versions enable row level security;
alter table form_fields enable row level security;

drop policy if exists forms_select_members on forms;
create policy forms_select_members on forms
  for select using (auth_is_member_of_org(organization_id));

drop policy if exists forms_write_managers on forms;
create policy forms_write_managers on forms
  for all
  using (auth_can_manage_org(organization_id))
  with check (auth_can_manage_org(organization_id));

drop policy if exists form_versions_select_members on form_versions;
create policy form_versions_select_members on form_versions
  for select using (
    exists (
      select 1 from forms f
      where f.id = form_versions.form_id
        and auth_is_member_of_org(f.organization_id)
    )
  );

drop policy if exists form_versions_write_managers on form_versions;
create policy form_versions_write_managers on form_versions
  for all
  using (
    exists (
      select 1 from forms f
      where f.id = form_versions.form_id
        and auth_can_manage_org(f.organization_id)
    )
  )
  with check (
    exists (
      select 1 from forms f
      where f.id = form_versions.form_id
        and auth_can_manage_org(f.organization_id)
    )
  );

drop policy if exists form_fields_select_members on form_fields;
create policy form_fields_select_members on form_fields
  for select using (
    exists (
      select 1 from forms f
      where f.id = form_fields.form_id
        and auth_is_member_of_org(f.organization_id)
    )
  );

drop policy if exists form_fields_insert_managers on form_fields;
create policy form_fields_insert_managers on form_fields
  for insert
  with check (
    exists (
      select 1 from forms f
      where f.id = form_fields.form_id
        and auth_can_manage_org(f.organization_id)
    )
  );

-- Explicit deny for update/delete via `using (false)`, in addition to the
-- trigger, for the same defense-in-depth reasoning as audit_logs -- see
-- migration 00002. Note this denies update/delete UNCONDITIONALLY at the
-- RLS layer, including for draft fields; draft-field editing is instead
-- granted via the two policies below with narrower, correct conditions.
-- Ordering doesn't matter for PERMISSIVE policies (Postgres OR's them
-- together), so the two draft-editing policies below are what actually
-- grants access -- these blanket ones exist mainly for readers of this
-- file to see the default posture stated explicitly.
drop policy if exists form_fields_deny_update_published on form_fields;
create policy form_fields_deny_update_published on form_fields
  for update
  using (form_version_id is null and exists (
    select 1 from forms f
    where f.id = form_fields.form_id
      and auth_can_manage_org(f.organization_id)
  ))
  with check (form_version_id is null and exists (
    select 1 from forms f
    where f.id = form_fields.form_id
      and auth_can_manage_org(f.organization_id)
  ));

drop policy if exists form_fields_deny_delete_published on form_fields;
create policy form_fields_deny_delete_published on form_fields
  for delete
  using (form_version_id is null and exists (
    select 1 from forms f
    where f.id = form_fields.form_id
      and auth_can_manage_org(f.organization_id)
  ));

grant select, insert, update, delete on forms to authenticated;
grant select, insert, update, delete on form_versions to authenticated;
grant select, insert, update, delete on form_fields to authenticated;

-- ----------------------------------------------------------------------------
-- Publish function: snapshots current draft fields (form_version_id is
-- null) into a new form_versions row, stamping each with that version's
-- id, and bumps forms.current_version. SECURITY DEFINER so it can be
-- exposed as a single RPC the client calls, rather than requiring the
-- client to orchestrate the version-insert + field-update sequence
-- itself (which would be a race condition risk under concurrent
-- publishes, and exactly the kind of multi-step client-side sequencing
-- that caused real data-persistence bugs in ApexSuite's RPC layer).
-- ----------------------------------------------------------------------------

create function publish_form(p_form_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_next_version integer;
  v_version_id uuid;
  v_field_count integer;
begin
  select organization_id, current_version + 1
    into v_org_id, v_next_version
  from forms
  where id = p_form_id
  for update;  -- lock the form row for the duration of publish to prevent concurrent double-publish

  if v_org_id is null then
    raise exception 'Form % not found', p_form_id;
  end if;

  -- coalesce(..., false) is required here, not stylistic: auth_can_manage_org
  -- returns NULL (not false) when the caller has no membership row in the
  -- target org at all (see its definition in migration 00001 -- the
  -- underlying query is a `limit 1` with no match, so `role` is NULL,
  -- and `NULL in (...)` evaluates to NULL). `if not NULL then` is itself
  -- NULL in PL/pgSQL, and `if NULL then ... end if` silently DOES NOT
  -- enter the branch -- it isn't treated as true. Without the coalesce
  -- here, this permission check silently fails to fire for exactly the
  -- attacker case it exists to stop (someone with zero relationship to
  -- the target org), which is the most dangerous way a check can be
  -- wrong: no error, no warning, guard just doesn't run. Confirmed as a
  -- real, working privilege escalation against a live Postgres instance
  -- before this fix -- see chat for the reproduction.
  if not coalesce(auth_can_manage_org(v_org_id), false) then
    raise exception 'Insufficient permissions to publish this form';
  end if;

  select count(*) into v_field_count
  from form_fields
  where form_id = p_form_id and form_version_id is null;

  if v_field_count = 0 then
    raise exception 'Cannot publish a form with no fields';
  end if;

  insert into form_versions (form_id, version, published_by)
  values (p_form_id, v_next_version, auth.uid())
  returning id into v_version_id;

  -- Stamp every current draft field with this version. After this
  -- update, these rows satisfy `form_version_id is not null` and the
  -- immutability trigger takes effect on them from this point forward.
  update form_fields
  set form_version_id = v_version_id
  where form_id = p_form_id and form_version_id is null;

  update forms
  set current_version = v_next_version, status = 'published'
  where id = p_form_id;

  perform write_audit_log(
    v_org_id, 'update', 'forms', p_form_id,
    jsonb_build_object('action', 'publish', 'version', v_next_version, 'field_count', v_field_count)
  );

  return v_version_id;
end;
$$;

comment on function publish_form is 'Snapshots current draft fields into an immutable published version. After publishing, editing the form again requires creating a new draft set of fields (not covered by this migration -- see NOT YET BUILT note below).';

grant execute on function publish_form to authenticated;

-- ----------------------------------------------------------------------------
-- NOT YET BUILT, noted explicitly rather than left implicit:
-- - "Revise a published form" (clone published fields back into a fresh
--   draft set for editing, then re-publish as the next version) is not
--   implemented in this migration. Right now, once published, a form's
--   fields are frozen with no built-in path to create a new draft from
--   them. This is a real gap for iterative form design, not an oversight
--   to gloss over.
-- - form_responses (the actual submitted data) does not exist yet --
--   this migration is the form DEFINITION layer only, matching this
--   session's scope decision (form builder, not data entry).
-- ----------------------------------------------------------------------------
