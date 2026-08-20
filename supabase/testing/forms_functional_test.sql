\echo '=== Form builder functional test ==='
-- Uses c1c1.../c2c2... prefixed IDs, deliberately distinct from
-- seed_two_orgs.sql's eeeeeeee.../ffffffff... fixture IDs. Originally
-- shared the eeeeeeee prefix; that collided once seed_two_orgs.sql grew
-- its own fixture form (added when building form_responses), causing
-- silent duplicate-key errors that cascaded into unrelated-looking
-- failures further down this file. Found while re-running this suite
-- after the migration 00006 publish_form fix, not a defect in that fix.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '--- Step 1: create a draft form + two fields as Org A admin ---'
insert into forms (id, organization_id, project_id, name, created_by)
values ('c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Household Nutrition Survey', '11111111-1111-1111-1111-111111111111')
returning id, status, current_version;

insert into form_fields (id, form_id, field_type, label, sort_order, is_required)
values
  ('c2c2c2c2-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'text', 'Household head name', 0, true),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'c1c1c1c1-0000-0000-0000-000000000001', 'number', 'Number of children under 5', 1, true)
returning id, label, form_version_id;

\echo ''
\echo '--- Step 2: confirm draft fields ARE editable pre-publish ---'
with attempt as (
  update form_fields set label = 'Household head full name' where id = 'c2c2c2c2-0000-0000-0000-000000000001' returning id
)
select case when count(*) = 1 then 'PASS: draft field edit succeeded' else 'FAIL: draft field edit was blocked' end from attempt;

\echo ''
\echo '--- Step 3: attempt to publish with only 2 fields, should succeed (field_count > 0) ---'
select publish_form('c1c1c1c1-0000-0000-0000-000000000001'::uuid) as version_id \gset
select 'PASS: publish returned version id ' || :'version_id' as publish_result;

select id, status, current_version from forms where id = 'c1c1c1c1-0000-0000-0000-000000000001';

\echo ''
\echo '--- Step 4: confirm published fields now carry a form_version_id ---'
select id, label, form_version_id is not null as is_published from form_fields where form_id = 'c1c1c1c1-0000-0000-0000-000000000001' order by sort_order;

\echo ''
\echo '--- Step 5: attempt to edit a NOW-PUBLISHED field. Must genuinely fail. ---'
with attempt as (
  update form_fields set label = 'TAMPERED LABEL' where id = 'c2c2c2c2-0000-0000-0000-000000000001' returning id
)
select case when count(*) = 0 then 'PASS: published field edit was blocked (0 rows changed)' else 'FAIL: published field edit succeeded' end from attempt;

\echo ''
\echo '--- Step 6: attempt to DELETE a published field. Must genuinely fail. ---'
with attempt as (
  delete from form_fields where id = 'c2c2c2c2-0000-0000-0000-000000000002' returning id
)
select case when count(*) = 0 then 'PASS: published field delete was blocked (0 rows changed)' else 'FAIL: published field delete succeeded' end from attempt;

\echo ''
\echo '--- Step 7: ground truth check as postgres -- was the label actually changed? ---'
reset role;
select id, label from form_fields where id = 'c2c2c2c2-0000-0000-0000-000000000001';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '--- Step 8: attempt to publish an EMPTY form (no fields at all). Must fail with a clear error, not silently succeed. ---'
insert into forms (id, organization_id, name, created_by)
values ('c1c1c1c1-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Empty Form', '11111111-1111-1111-1111-111111111111');
do $$
begin
  begin
    perform publish_form('c1c1c1c1-0000-0000-0000-000000000002'::uuid);
    raise notice 'FAIL: publishing an empty form succeeded';
  exception when others then
    raise notice 'PASS: publishing an empty form was rejected (%)', sqlerrm;
  end;
end $$;

\echo ''
\echo '--- Step 9: cross-org isolation on the new tables -- Org A admin attempts to read Org B forms/fields directly by guessed table scan ---'
select count(*) as forms_visible from forms;
select count(*) as fields_visible from form_fields;

\echo ''
\echo '=== Step 10: switch to Org B admin, confirm Org A''s form is completely invisible ==='
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as org_b_sees_of_org_a_forms from forms where id = 'c1c1c1c1-0000-0000-0000-000000000001';

\echo ''
\echo '--- Step 11: Org B admin attempts to publish Org A''s form directly by ID (privilege escalation attempt) ---'
-- Corrected AGAIN from the previous version: Org A's form from Step 1 is
-- already published, so ALL its fields now carry a non-null
-- form_version_id, meaning the field_count guard in publish_form
-- legitimately returns 0 (nothing left in draft state to snapshot) --
-- that's a different, also-correct guard firing, not the org-ownership
-- check this step means to isolate. To actually isolate the permission
-- check, Org A needs a SECOND form with fresh draft fields still
-- unpublished, so the field-count guard passes and the permission check
-- is the only thing left standing.
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into forms (id, organization_id, name, created_by)
values ('c1c1c1c1-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Org A Second Form (unpublished, for escalation test)', '11111111-1111-1111-1111-111111111111');
insert into form_fields (form_id, field_type, label, sort_order)
values ('c1c1c1c1-0000-0000-0000-000000000003', 'text', 'Some field', 0);

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
begin
  begin
    perform publish_form('c1c1c1c1-0000-0000-0000-000000000003'::uuid);
    raise notice 'FAIL: Org B was able to publish Org A''s form (real privilege escalation)';
  exception when others then
    raise notice 'PASS: cross-org publish attempt was rejected (%)', sqlerrm;
  end;
end $$;

\echo ''
\echo '--- Step 11b: ground truth -- confirm the form is STILL draft, was not actually published by Org B ---'
reset role;
select id, status, current_version from forms where id = 'c1c1c1c1-0000-0000-0000-000000000003';

reset role;
