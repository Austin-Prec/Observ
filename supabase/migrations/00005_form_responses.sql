-- ============================================================================
-- 00005_form_responses.sql
-- Data collection: actual submitted responses against published forms.
--
-- Key design decisions:
--
-- 1. Responses reference form_version_id, NOT form_id directly. This is
--    the entire reason form versioning (migration 00004) exists: a
--    response answered against v1 of a form must remain interpretable
--    even after the form is edited and republished as v2 with different
--    fields. Querying "all responses to this form" means joining through
--    form_versions to forms, which is one extra join in exchange for
--    responses never silently becoming orphaned or mismatched against a
--    schema they weren't actually collected under.
--
-- 2. One answer per field per response (response_answers), not one jsonb
--    blob per response. This is deliberate for the same reason
--    indicators aren't a jsonb array: Section 5 of the spec requires a
--    query builder that filters/groups/pivots "across multiple
--    indicators, projects, and dimensions" -- that needs to run SQL
--    WHERE/GROUP BY against individual field values, which a blob
--    prevents (or forces into brittle jsonb path queries per field type
--    the query builder would need to special-case). The field-per-row
--    cost is more storage and one more join; the benefit is that
--    aggregate/filter/group-by all become ordinary SQL against a real
--    column, which is what makes the analysis module in a later
--    migration tractable at all.
--
-- 3. answer_value is stored as text with a parallel answer_numeric column
--    for quantitative fields specifically. Neither field_type nor the
--    Postgres type system can cleanly hold "date OR number OR free text
--    OR a JSON array of checkbox selections" in one native column without
--    either a wide sparse table (one column per possible type, mostly
--    null) or jsonb (which reintroduces the query-builder problem from
--    #2 for the common numeric case). Splitting out answer_numeric
--    specifically is the compromise: the single most common analysis
--    operation (mean/sum/regression on a quantitative indicator) gets a
--    real indexed numeric column, while every other type (text, date,
--    single-choice, GPS, file references) lives in answer_value as text,
--    parsed by the application layer using the field's field_type as the
--    discriminator it already has.
--
-- 4. Idempotent sync via client_submission_id. Per spec section 3
--    (offline-first mobile collection), a submission composed offline
--    may be retried on flaky connectivity; a unique constraint on
--    (form_version_id, client_submission_id) means a retried sync is a
--    no-op rather than a duplicate record, without requiring the client
--    to track server-side success state perfectly.
-- ============================================================================

create type response_status as enum ('submitted', 'verified', 'flagged', 'rejected');

-- ----------------------------------------------------------------------------
-- Responses: one row per form submission.
-- ----------------------------------------------------------------------------

create table form_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  form_version_id uuid not null references form_versions(id) on delete restrict,
  -- Denormalized for RLS/query convenience (avoids a join through
  -- form_versions -> forms just to filter "responses for this project").
  -- Kept consistent with form_version_id by the set_response_project_id
  -- trigger below rather than trusted as independently client-supplied.
  project_id uuid references projects(id) on delete set null,
  -- Who collected it. Nullable to allow a future anonymous/self-service
  -- submission path (e.g. a customer portal), though nothing in this
  -- migration builds that path yet -- see NOT YET BUILT.
  collected_by uuid references profiles(id),
  status response_status not null default 'submitted',
  -- Distinct from synced_at: a Data Collector may complete this offline
  -- in the field with no signal, then sync hours or days later. Both
  -- facts matter -- submitted_at for "when did data collection actually
  -- happen" (the correct timestamp for time-series analysis), synced_at
  -- for operational/sync-debugging visibility.
  submitted_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  -- Idempotent-sync key: a client generates this once at submission time
  -- (e.g. a UUID from the mobile app) and retries safely on failure.
  client_submission_id uuid,
  -- GPS coordinates for the submission itself (distinct from a
  -- gps_coordinates FIELD TYPE, which captures a location as an ANSWER
  -- to a specific question -- this captures where/when the device was
  -- when the whole form was submitted, useful for basic geospatial
  -- mapping per spec section 5 even before a field-level GPS answer
  -- exists on a given form).
  latitude double precision,
  longitude double precision,
  -- Verification workflow (spec section 4: "Workflow for
  -- verifying/validating submitted data ... with an audit trail"). The
  -- audit trail itself is audit_logs (migration 00002); this column is
  -- the current state, verify_response()/flag_response() below are the
  -- only sanctioned transitions and each writes an audit_logs entry.
  verified_by uuid references profiles(id),
  verified_at timestamptz,
  verification_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_responses_client_submission_unique unique (form_version_id, client_submission_id),
  constraint form_responses_lat_valid check (latitude is null or (latitude between -90 and 90)),
  constraint form_responses_lng_valid check (longitude is null or (longitude between -180 and 180)),
  constraint form_responses_verified_fields_consistent check (
    (status = 'verified') = (verified_by is not null and verified_at is not null)
  )
);

comment on table form_responses is 'One row per form submission, pinned to an immutable form_version. Never references forms.id directly -- see migration header.';

create index idx_form_responses_org on form_responses(organization_id);
create index idx_form_responses_version on form_responses(form_version_id);
create index idx_form_responses_project on form_responses(project_id);
create index idx_form_responses_status on form_responses(status);
create index idx_form_responses_submitted_at on form_responses(submitted_at);

create trigger trg_form_responses_updated_at
  before update on form_responses
  for each row execute function set_updated_at();

-- Keep project_id consistent with form_version_id -> forms.project_id
-- automatically, rather than trusting a client-supplied project_id to
-- match (which would let a client mis-file a response under the wrong
-- project, corrupting any project-scoped analysis).
create function set_response_project_id()
returns trigger
language plpgsql
as $$
begin
  select f.project_id into NEW.project_id
  from form_versions fv
  join forms f on f.id = fv.form_id
  where fv.id = NEW.form_version_id;
  return NEW;
end;
$$;

create trigger trg_form_responses_set_project_id
  before insert on form_responses
  for each row execute function set_response_project_id();

-- ----------------------------------------------------------------------------
-- Response answers: one row per field per response.
-- ----------------------------------------------------------------------------

create table response_answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references form_responses(id) on delete cascade,
  -- References the specific PUBLISHED field (form_version_id is not
  -- null, guaranteed by the check constraint below), not a draft field --
  -- an answer can only exist against a question that was actually part
  -- of the published version the respondent saw.
  field_id uuid not null references form_fields(id) on delete restrict,
  -- Text representation of the answer, meaning depends on the field's
  -- field_type: free text for 'text', ISO date string for 'date', a
  -- single selected value for 'dropdown'/'radio', a comma-joined list of
  -- selected values for 'checkbox', a file/storage reference for
  -- 'photo_upload'/'file_upload'/'signature', "lat,lng" for
  -- 'gps_coordinates', scanned code content for 'barcode_qr'. See
  -- migration header point 3 for why this isn't further split by type.
  answer_value text,
  -- Populated (and NOT NULL, per the check constraint) specifically when
  -- the field is 'number' or 'likert_scale' -- these are the two types
  -- where a real, indexed numeric column pays for itself immediately in
  -- the analysis module (mean/sum/regression need a numeric column, not
  -- a text one that must be cast at query time).
  answer_numeric numeric,
  created_at timestamptz not null default now(),
  unique (response_id, field_id)
);

comment on table response_answers is 'One row per field per response. answer_numeric is populated redundantly with answer_value for number/likert_scale fields to give the analysis module a real indexed numeric column.';

create index idx_response_answers_response on response_answers(response_id);
create index idx_response_answers_field on response_answers(field_id);
create index idx_response_answers_numeric on response_answers(field_id, answer_numeric) where answer_numeric is not null;

-- Enforce that field_id points to a PUBLISHED field (form_version_id not
-- null). An answer against a draft-only field would mean either the
-- field was later published with a different definition (the answer's
-- meaning is now ambiguous) or never published at all (the field
-- shouldn't have been answerable). Checked via trigger rather than a
-- table CHECK constraint, since it requires a cross-table lookup.
create function check_answer_field_is_published()
returns trigger
language plpgsql
as $$
declare
  v_form_version_id uuid;
begin
  select form_version_id into v_form_version_id
  from form_fields
  where id = NEW.field_id;

  if v_form_version_id is null then
    raise exception 'response_answers.field_id % refers to a draft (unpublished) field, which cannot be answered', NEW.field_id;
  end if;

  return NEW;
end;
$$;

create trigger trg_response_answers_field_published
  before insert or update of field_id on response_answers
  for each row execute function check_answer_field_is_published();

-- Response answers, once written, are not intended to be edited freely
-- either -- data QUALITY corrections belong in the data-cleaning
-- workflow (spec section 4: "review, edit, flag, or delete records"),
-- which needs its own audit trail of WHAT changed and WHY, not a silent
-- UPDATE. That cleaning workflow is explicitly NOT built in this
-- migration (see NOT YET BUILT) -- for now, response_answers rows are
-- append-only at the schema level (no update/delete policy is granted;
-- see RLS section), matching the "don't build half a guarantee" stance
-- taken with audit_logs and form_fields. A real edit/correction path
-- requires its own migration with its own audit story, not a bare
-- UPDATE grant bolted on here.

-- ----------------------------------------------------------------------------
-- Row Level Security
--
-- Read: any org member can see responses (Analysts need this; a
-- dashboard/report needs this). This is broader than form_fields'
-- read policy intentionally -- the spec's role list gives Analyst
-- explicit read/analysis rights, and restricting response READ to
-- managers-only would block the Analyst role from doing analysis at all.
--
-- Write (insert): any org member with a role in
-- ('administrator','manager','analyst','data_collector') may submit --
-- i.e., everyone except plain 'viewer'. This matches the spec's role
-- table, where Data Collector is specifically the submission role.
--
-- Update: restricted to the verification-workflow columns only, via the
-- verify_response()/flag_response() functions below (SECURITY DEFINER,
-- narrow), not a general UPDATE grant -- consistent with the "no silent
-- edits" stance above.
-- ----------------------------------------------------------------------------

alter table form_responses enable row level security;
alter table response_answers enable row level security;

drop policy if exists form_responses_select_members on form_responses;
create policy form_responses_select_members on form_responses
  for select using (auth_is_member_of_org(organization_id));

drop policy if exists form_responses_insert_collectors on form_responses;
create policy form_responses_insert_collectors on form_responses
  for insert
  with check (
    coalesce(auth_role_in_org(organization_id) in
      ('administrator', 'manager', 'analyst', 'data_collector'), false)
  );

-- No general UPDATE/DELETE policy for authenticated -- see verification
-- functions below, which are the only sanctioned mutation path, and
-- explicit deny policies mirroring the audit_logs/form_fields pattern
-- (verified in prior sessions: an absent policy still allows silent
-- zero-match rather than a clear signal, so denying explicitly is more
-- legible even though functionally equivalent for ordinary roles).
drop policy if exists form_responses_deny_update on form_responses;
create policy form_responses_deny_update on form_responses
  for update using (false);

drop policy if exists form_responses_deny_delete on form_responses;
create policy form_responses_deny_delete on form_responses
  for delete using (false);

drop policy if exists response_answers_select_members on response_answers;
create policy response_answers_select_members on response_answers
  for select using (
    exists (
      select 1 from form_responses fr
      where fr.id = response_answers.response_id
        and auth_is_member_of_org(fr.organization_id)
    )
  );

drop policy if exists response_answers_insert_collectors on response_answers;
create policy response_answers_insert_collectors on response_answers
  for insert
  with check (
    exists (
      select 1 from form_responses fr
      where fr.id = response_answers.response_id
        and coalesce(auth_role_in_org(fr.organization_id) in
          ('administrator', 'manager', 'analyst', 'data_collector'), false)
    )
  );

drop policy if exists response_answers_deny_update on response_answers;
create policy response_answers_deny_update on response_answers
  for update using (false);

drop policy if exists response_answers_deny_delete on response_answers;
create policy response_answers_deny_delete on response_answers
  for delete using (false);

grant select, insert on form_responses to authenticated;
grant select, insert on response_answers to authenticated;

-- ----------------------------------------------------------------------------
-- Submission RPC: atomically inserts a response plus all its answers in
-- one call. This matters for the same reason publish_form() is one RPC
-- rather than client-orchestrated steps: a partial submission (response
-- row written, answers write fails halfway) would corrupt analysis with
-- a phantom response that has some-but-not-all of its answers, and
-- there's no client-side way to guarantee atomicity across multiple
-- separate insert calls under network failure -- exactly the class of
-- bug that caused real data-persistence issues in ApexSuite's RPC layer
-- historically (hand-enumerated writes silently dropping fields).
--
-- Takes answers as jsonb: [{"field_id": "...", "value": "...", "numeric": 1.5}, ...]
-- rather than requiring the caller to have already validated field_type-
-- specific shape client-side -- validation against the field's actual
-- field_type and required-ness happens here, server-side, where it
-- cannot be bypassed by a modified client.
-- ----------------------------------------------------------------------------

create function submit_form_response(
  p_form_version_id uuid,
  p_answers jsonb,
  p_client_submission_id uuid default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_submitted_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_response_id uuid;
  v_answer jsonb;
  v_field record;
  v_required_field_ids uuid[];
  v_answered_field_ids uuid[];
  v_missing_count integer;
begin
  select f.organization_id into v_org_id
  from form_versions fv
  join forms f on f.id = fv.form_id
  where fv.id = p_form_version_id;

  if v_org_id is null then
    raise exception 'Form version % not found', p_form_version_id;
  end if;

  if not coalesce(auth_role_in_org(v_org_id) in
    ('administrator', 'manager', 'analyst', 'data_collector'), false) then
    raise exception 'Insufficient permissions to submit a response for this form';
  end if;

  -- Idempotent retry: if this exact client_submission_id was already
  -- synced for this form_version, return the existing response id
  -- rather than erroring or duplicating.
  if p_client_submission_id is not null then
    select id into v_response_id
    from form_responses
    where form_version_id = p_form_version_id
      and client_submission_id = p_client_submission_id;

    if v_response_id is not null then
      return v_response_id;
    end if;
  end if;

  -- Validate required fields are all present in the payload BEFORE
  -- writing anything, so a missing-required-field submission fails
  -- cleanly with zero partial writes rather than needing a rollback.
  select array_agg(id) into v_required_field_ids
  from form_fields
  where form_version_id = p_form_version_id and is_required = true;

  select array_agg((elem ->> 'field_id')::uuid) into v_answered_field_ids
  from jsonb_array_elements(p_answers) as elem;

  if v_required_field_ids is not null then
    select count(*) into v_missing_count
    from unnest(v_required_field_ids) as req_id
    where req_id != all(coalesce(v_answered_field_ids, array[]::uuid[]));

    if v_missing_count > 0 then
      raise exception 'Submission is missing % required field(s)', v_missing_count;
    end if;
  end if;

  insert into form_responses (
    organization_id, form_version_id, collected_by,
    client_submission_id, latitude, longitude, submitted_at
  ) values (
    v_org_id, p_form_version_id, auth.uid(),
    p_client_submission_id, p_latitude, p_longitude,
    coalesce(p_submitted_at, now())
  )
  returning id into v_response_id;

  for v_answer in select * from jsonb_array_elements(p_answers)
  loop
    select id, field_type into v_field
    from form_fields
    where id = (v_answer ->> 'field_id')::uuid
      and form_version_id = p_form_version_id;

    if v_field.id is null then
      raise exception 'Field % is not part of form version %, or is not a published field', v_answer ->> 'field_id', p_form_version_id;
    end if;

    insert into response_answers (response_id, field_id, answer_value, answer_numeric)
    values (
      v_response_id,
      v_field.id,
      v_answer ->> 'value',
      case
        when v_field.field_type in ('number', 'likert_scale') and (v_answer ->> 'value') is not null
          then (v_answer ->> 'value')::numeric
        else null
      end
    );
  end loop;

  perform write_audit_log(
    v_org_id, 'create', 'form_responses', v_response_id,
    jsonb_build_object('form_version_id', p_form_version_id, 'answer_count', jsonb_array_length(p_answers))
  );

  return v_response_id;
end;
$$;

comment on function submit_form_response is 'Atomic submission: validates required fields, writes the response + all answers in one transaction, idempotent on client_submission_id for offline sync retries.';

grant execute on function submit_form_response to authenticated;

-- ----------------------------------------------------------------------------
-- Verification workflow RPCs (spec section 4). Both narrow, both audit-
-- logged, both restricted to manage-level roles -- a Data Collector
-- should not be able to verify their own submission.
-- ----------------------------------------------------------------------------

create function verify_response(p_response_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id from form_responses where id = p_response_id for update;

  if v_org_id is null then
    raise exception 'Response % not found', p_response_id;
  end if;

  if not coalesce(auth_can_manage_org(v_org_id), false) then
    raise exception 'Insufficient permissions to verify this response';
  end if;

  update form_responses
  set status = 'verified', verified_by = auth.uid(), verified_at = now(), verification_note = p_note
  where id = p_response_id;

  perform write_audit_log(v_org_id, 'update', 'form_responses', p_response_id, jsonb_build_object('action', 'verify', 'note', p_note));
end;
$$;

create function flag_response(p_response_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if p_note is null or trim(p_note) = '' then
    raise exception 'A note explaining the flag is required';
  end if;

  select organization_id into v_org_id from form_responses where id = p_response_id for update;

  if v_org_id is null then
    raise exception 'Response % not found', p_response_id;
  end if;

  if not coalesce(auth_can_manage_org(v_org_id), false) then
    raise exception 'Insufficient permissions to flag this response';
  end if;

  update form_responses
  set status = 'flagged', verified_by = auth.uid(), verified_at = now(), verification_note = p_note
  where id = p_response_id;

  perform write_audit_log(v_org_id, 'update', 'form_responses', p_response_id, jsonb_build_object('action', 'flag', 'note', p_note));
end;
$$;

grant execute on function verify_response to authenticated;
grant execute on function flag_response to authenticated;

-- ----------------------------------------------------------------------------
-- NOT YET BUILT, noted explicitly:
-- - Editing/correcting an already-submitted answer (data cleaning per
--   spec section 4: "review, edit, flag, or delete records"). This
--   migration deliberately ships flag-with-note as the only "something
--   is wrong with this record" action; a real edit workflow needs its
--   own before/after audit trail and is a separate migration, not a bare
--   UPDATE grant added later without that trail.
-- - Merge/deduplicate records (spec section 4).
-- - Anonymous/public submission path (e.g. customer portal) -- RLS here
--   assumes a submitter has an org membership; collected_by/RLS would
--   need rework for a truly public form.
-- - Anything in spec section 5 (analysis) or 6 (reporting) -- this
--   migration is the data-capture layer those would read from.
-- ============================================================================
