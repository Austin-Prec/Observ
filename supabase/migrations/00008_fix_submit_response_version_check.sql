-- ============================================================================
-- 00008_fix_submit_response_version_check.sql
--
-- submit_form_response() (migration 00005) validated each answered field
-- with:
--   select ... from form_fields where id = ... and form_version_id = p_form_version_id
--
-- This is the exact pre-00006 single-version assumption that migration
-- 00006 was written to correct -- and it is arguably the MOST important
-- of the three places that assumption lived (the other two: publish_form
-- itself, already fixed in 00006; the /collect page's field-listing
-- query, already fixed in the app layer). This one gates whether a
-- submission is accepted at all. It was missed in 00006 because 00006
-- was written and unit-tested against publish_form's own carry-forward
-- logic specifically -- the first real submission attempt against a v2
-- form (built for this session's analysis dataset) is what surfaced it,
-- not a broader audit for the same pattern across the codebase. That's
-- a real process gap worth naming: fixing a wrong assumption in one
-- place doesn't guarantee finding every place it was duplicated.
--
-- Corrected to check form_version_fields (the actual many-to-many
-- membership table) instead of the field's own (single,
-- first-published-version) form_version_id.
-- ============================================================================

create or replace function submit_form_response(
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

  if p_client_submission_id is not null then
    select id into v_response_id
    from form_responses
    where form_version_id = p_form_version_id
      and client_submission_id = p_client_submission_id;

    if v_response_id is not null then
      return v_response_id;
    end if;
  end if;

  -- Required fields now come from form_version_fields joined to
  -- form_fields (this version's actual field set, carried-forward +
  -- new), not a direct form_fields.form_version_id filter (this
  -- version's NEWLY-published fields only -- the bug).
  select array_agg(ff.id) into v_required_field_ids
  from form_version_fields vf
  join form_fields ff on ff.id = vf.field_id
  where vf.form_version_id = p_form_version_id and ff.is_required = true;

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
    -- THE FIX: join through form_version_fields to confirm this field
    -- genuinely belongs to THIS version's field set, rather than
    -- checking the field's own (single) form_version_id, which only
    -- ever equals the version the field was FIRST published under.
    select ff.id, ff.field_type into v_field
    from form_version_fields vf
    join form_fields ff on ff.id = vf.field_id
    where ff.id = (v_answer ->> 'field_id')::uuid
      and vf.form_version_id = p_form_version_id;

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
