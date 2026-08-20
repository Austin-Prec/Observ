-- ============================================================================
-- 00006_form_version_fields.sql
--
-- Fixes a real modeling bug in migration 00004, discovered while seeding
-- a realistic analysis dataset in this session -- not found by static
-- review, found by actually trying to publish a form a second time and
-- watching every subsequent submission fail with "field is not part of
-- this version."
--
-- THE BUG: form_fields.form_version_id modeled a field as belonging to
-- EXACTLY ONE version. publish_form() only stamped currently-draft
-- fields with the new version_id -- it never carried forward fields that
-- were already published under an earlier version. The practical
-- consequence: publishing v2 of a form that adds one new field to an
-- existing v1 produced a v2 that contained ONLY the new field. The real
-- /collect page (queries form_fields where form_version_id = <current
-- version>) would have silently shown respondents only the newest
-- question, dropping every field from earlier versions -- in
-- production, this would have meant a form republished to add "did
-- respondent consent" would have silently stopped asking every other
-- question on the form. This was never caught earlier because no prior
-- session ever exercised "publish a SECOND version of the same form."
--
-- THE FIX: form_fields keeps its current meaning UNCHANGED -- one row
-- per field, immutable once first published (this is still the correct
-- guarantee: a v1 answer must always resolve against the exact
-- wording/type that existed when the respondent actually saw it). What
-- was wrong was conflating "immutable once published" with "belongs to
-- exactly one version." A new join table, form_version_fields, records
-- WHICH versions a given field belongs to, many-to-many. publish_form()
-- is corrected to populate this join table with every currently-live
-- field (carried forward from the prior version, plus any new drafts),
-- not just the new drafts.
-- ============================================================================

create table form_version_fields (
  form_version_id uuid not null references form_versions(id) on delete cascade,
  field_id uuid not null references form_fields(id) on delete restrict,
  -- sort_order is duplicated here (also exists on form_fields) rather
  -- than only living on form_fields, because ordering is genuinely a
  -- per-version concern: a field's position within version 2 of a form
  -- may differ from its position in version 3, even though the field
  -- itself (its type, its wording) is immutable. Defaulting from
  -- form_fields.sort_order at insert time (see publish_form below) keeps
  -- this consistent unless a future feature deliberately reorders
  -- per-version.
  sort_order integer not null default 0,
  primary key (form_version_id, field_id)
);

comment on table form_version_fields is 'Many-to-many: which fields belong to which published version. Corrects the 00004 assumption that a field belongs to exactly one version. See migration header for the bug this fixes.';

create index idx_form_version_fields_version on form_version_fields(form_version_id);
create index idx_form_version_fields_field on form_version_fields(field_id);

alter table form_version_fields enable row level security;

drop policy if exists form_version_fields_select_members on form_version_fields;
create policy form_version_fields_select_members on form_version_fields
  for select using (
    exists (
      select 1 from form_versions fv
      join forms f on f.id = fv.form_id
      where fv.id = form_version_fields.form_version_id
        and auth_is_member_of_org(f.organization_id)
    )
  );

-- No insert/update/delete grant to authenticated -- populated exclusively
-- by publish_form() (SECURITY DEFINER), same rationale as form_versions
-- itself: this is a system-maintained snapshot record, not something a
-- client should write to directly.
grant select on form_version_fields to authenticated;

-- ----------------------------------------------------------------------------
-- Corrected publish_form(). Replaces the version from migration 00004.
--
-- Behavior change: now populates form_version_fields with EVERY
-- currently-live field for this form (fields already published under
-- the immediately prior version, carried forward, PLUS any new draft
-- fields), not just the new drafts. Draft fields are still stamped with
-- form_fields.form_version_id = this new version on first publish
-- (unchanged from 00004 -- this is what makes a field's immutability
-- trigger engage the first time). Fields carried forward from a prior
-- version are NOT re-stamped or duplicated in form_fields -- they get a
-- new form_version_fields row, that's all; the field row itself
-- (already immutable from its own first publish) is untouched.
-- ----------------------------------------------------------------------------

create or replace function publish_form(p_form_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_current_version integer;
  v_next_version integer;
  v_version_id uuid;
  v_prior_version_id uuid;
  v_new_field_count integer;
  v_carried_field_count integer;
begin
  select organization_id, current_version, current_version + 1
    into v_org_id, v_current_version, v_next_version
  from forms
  where id = p_form_id
  for update;

  if v_org_id is null then
    raise exception 'Form % not found', p_form_id;
  end if;

  if not coalesce(auth_can_manage_org(v_org_id), false) then
    raise exception 'Insufficient permissions to publish this form';
  end if;

  select count(*) into v_new_field_count
  from form_fields
  where form_id = p_form_id and form_version_id is null;

  -- Locate the immediately prior version (if any) so its fields can be
  -- carried forward. On a form's FIRST publish, v_current_version = 0
  -- and there is no prior form_versions row -- v_prior_version_id stays
  -- null, and the carry-forward step below correctly does nothing.
  if v_current_version > 0 then
    select id into v_prior_version_id
    from form_versions
    where form_id = p_form_id and version = v_current_version;
  end if;

  select count(*) into v_carried_field_count
  from form_version_fields
  where form_version_id = v_prior_version_id;

  -- A publish must add real value: either new draft fields exist, or
  -- there's a prior version with fields to carry forward. Publishing
  -- with neither would create an empty version, which is the same
  -- "empty form" problem migration 00004 already guarded against for
  -- first publishes -- extending that guard to also cover the "publish
  -- again with nothing new" case, since that's now a real possibility
  -- this migration introduces (00004 couldn't reach this state at all).
  if v_new_field_count = 0 and v_carried_field_count = 0 then
    raise exception 'Cannot publish a form with no fields';
  end if;

  insert into form_versions (form_id, version, published_by)
  values (p_form_id, v_next_version, auth.uid())
  returning id into v_version_id;

  -- Carry forward every field from the prior version's field set,
  -- unchanged, into the new version's field set. This is the actual
  -- fix: 00004's publish_form never did this step at all.
  if v_prior_version_id is not null then
    insert into form_version_fields (form_version_id, field_id, sort_order)
    select v_version_id, field_id, sort_order
    from form_version_fields
    where form_version_id = v_prior_version_id;
  end if;

  -- Stamp new draft fields as immutable (unchanged from 00004) AND add
  -- them to this version's field set.
  update form_fields
  set form_version_id = v_version_id
  where form_id = p_form_id and form_version_id is null;

  insert into form_version_fields (form_version_id, field_id, sort_order)
  select v_version_id, id, sort_order
  from form_fields
  where form_id = p_form_id and form_version_id = v_version_id;

  update forms
  set current_version = v_next_version, status = 'published'
  where id = p_form_id;

  perform write_audit_log(
    v_org_id, 'update', 'forms', p_form_id,
    jsonb_build_object(
      'action', 'publish', 'version', v_next_version,
      'new_field_count', v_new_field_count, 'carried_field_count', v_carried_field_count
    )
  );

  return v_version_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- NOT YET BUILT, noted explicitly (extends the note from 00004):
-- - Removing a field from a form for a future version (i.e. NOT carrying
--   it forward) is not exposed by any function yet -- publish_form
--   always carries forward every field from the prior version. A "retire
--   this field going forward" action needs its own explicit mechanism,
--   not an implicit "just don't carry it forward" default, since the
--   correct default for accountability software is that removing a
--   question from data collection should be a deliberate, audited
--   action, not a side effect of forgetting to re-add it.
-- - Reordering a field's sort_order for a NEW version without touching
--   form_fields.sort_order (which reflects the field's original/most
--   recent draft ordering) is possible via direct manipulation of
--   form_version_fields.sort_order, but no UI or function exposes this
--   yet -- publish_form currently just copies sort_order as-is.
-- ============================================================================
