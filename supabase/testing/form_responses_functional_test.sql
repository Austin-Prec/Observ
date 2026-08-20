\echo '=== submit_form_response functional test ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '--- Step 1: valid submission with all 3 fields answered ---'
select submit_form_response(
  '11111111-aaaa-0000-0000-000000000001'::uuid,
  jsonb_build_array(
    jsonb_build_object('field_id', 'ffffffff-0000-0000-0000-000000000001', 'value', 'Chikondi Banda'),
    jsonb_build_object('field_id', 'ffffffff-0000-0000-0000-000000000002', 'value', '3'),
    jsonb_build_object('field_id', 'ffffffff-0000-0000-0000-000000000003', 'value', 'secure')
  ),
  'aaaa1111-0000-0000-0000-000000000001'::uuid  -- client_submission_id
) as response_id_1 \gset

select case when :'response_id_1' is not null then 'PASS: submission returned a response id' else 'FAIL' end;

\echo ''
\echo '--- Step 2: confirm all 3 answers were actually written, with correct types ---'
select field_id, answer_value, answer_numeric from response_answers where response_id = :'response_id_1'::uuid order by field_id;

\echo ''
\echo '--- Step 3: confirm the numeric field genuinely got a numeric answer_numeric value, not just text ---'
select
  case when answer_numeric = 3 then 'PASS: number field correctly parsed to answer_numeric = 3' else 'FAIL: answer_numeric = ' || coalesce(answer_numeric::text, 'NULL') end
from response_answers where field_id = 'ffffffff-0000-0000-0000-000000000002' and response_id = :'response_id_1'::uuid;

\echo ''
\echo '--- Step 4: submission MISSING a required field (household head name) -- must be rejected, zero rows written ---'
do $$
begin
  begin
    perform submit_form_response(
      '11111111-aaaa-0000-0000-000000000001'::uuid,
      jsonb_build_array(
        jsonb_build_object('field_id', 'ffffffff-0000-0000-0000-000000000002', 'value', '2')
      )
    );
    raise notice 'FAIL: submission missing a required field succeeded';
  exception when others then
    raise notice 'PASS: submission missing a required field was rejected (%)', sqlerrm;
  end;
end $$;

\echo ''
\echo '--- Step 5: ground truth -- confirm the rejected submission from Step 4 did NOT leave a partial response row ---'
select count(*) as response_count_should_still_be_1 from form_responses where form_version_id = '11111111-aaaa-0000-0000-000000000001'::uuid;

\echo ''
\echo '--- Step 6: idempotent retry -- resubmitting the SAME client_submission_id must return the SAME response id, not create a duplicate ---'
select submit_form_response(
  '11111111-aaaa-0000-0000-000000000001'::uuid,
  jsonb_build_array(
    jsonb_build_object('field_id', 'ffffffff-0000-0000-0000-000000000001', 'value', 'Chikondi Banda'),
    jsonb_build_object('field_id', 'ffffffff-0000-0000-0000-000000000002', 'value', '3')
  ),
  'aaaa1111-0000-0000-0000-000000000001'::uuid  -- SAME client_submission_id as Step 1
) as response_id_retry \gset

select case when :'response_id_retry' = :'response_id_1' then 'PASS: retry returned the SAME response id (idempotent)' else 'FAIL: retry created a new response ' || :'response_id_retry' end;

select case when count(*) = 1 then 'PASS: still exactly 1 response row for this form version, no duplicate created' else 'FAIL: ' || count(*) || ' response rows exist' end
from form_responses where form_version_id = '11111111-aaaa-0000-0000-000000000001'::uuid;

\echo ''
\echo '--- Step 7: attempt to answer a field that does NOT belong to this form_version (cross-form injection attempt) ---'
do $$
begin
  begin
    perform submit_form_response(
      '11111111-aaaa-0000-0000-000000000001'::uuid,
      jsonb_build_array(
        jsonb_build_object('field_id', 'ffffffff-0000-0000-0000-000000000001', 'value', 'Test'),
        jsonb_build_object('field_id', 'ffffffff-0000-0000-0000-000000000002', 'value', '1'),
        jsonb_build_object('field_id', '99999999-0000-0000-0000-000000000000', 'value', 'bogus field id')
      )
    );
    raise notice 'FAIL: submission with a bogus/foreign field_id succeeded';
  exception when others then
    raise notice 'PASS: submission with a bogus field_id was rejected (%)', sqlerrm;
  end;
end $$;

\echo ''
\echo '--- Step 8: cross-org isolation -- Org B admin attempts to read Org A responses directly ---'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as org_b_sees_of_org_a_responses from form_responses where form_version_id = '11111111-aaaa-0000-0000-000000000001'::uuid;

\echo ''
\echo '--- Step 9: Org B admin attempts to submit a response against Org A''s form directly ---'
do $$
begin
  begin
    perform submit_form_response(
      '11111111-aaaa-0000-0000-000000000001'::uuid,
      jsonb_build_array(
        jsonb_build_object('field_id', 'ffffffff-0000-0000-0000-000000000001', 'value', 'Malicious'),
        jsonb_build_object('field_id', 'ffffffff-0000-0000-0000-000000000002', 'value', '99')
      )
    );
    raise notice 'FAIL: Org B was able to submit against Org A''s form';
  exception when others then
    raise notice 'PASS: cross-org submission was rejected (%)', sqlerrm;
  end;
end $$;

\echo ''
\echo '--- Step 10: Data Collector role attempts to VERIFY a response -- must be REJECTED (verification is manager+ only) ---'
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
-- :'variable' psql interpolation cannot be used directly inside a
-- dollar-quoted DO block -- confirmed the hard way in an earlier session
-- (see rls_isolation_test.sql history). Using the same format()-based
-- workaround verified there: build the block as a string with the id
-- substituted first, then execute it.
select format($fmt$
do $$
begin
  begin
    perform verify_response('%1$s'::uuid, 'Self-verifying, should not be allowed.');
    raise notice 'FAIL: Data Collector was able to verify a response';
  exception when others then
    raise notice 'PASS: Data Collector verify attempt was rejected (%%)', sqlerrm;
  end;
end $$;
$fmt$, :'response_id_1') as step10_sql \gset

:step10_sql

\echo ''
\echo '--- Step 10b: ground truth -- confirm status is still whatever it was before Step 10''s attempt (not verified by the collector) ---'
reset role;
select status, verified_by from form_responses where id = :'response_id_1'::uuid;
set role authenticated;

\echo ''
\echo '--- Step 10c: same Data Collector legitimately SUBMITTING a new response -- must succeed (this IS their permitted action) ---'
select submit_form_response(
  '11111111-aaaa-0000-0000-000000000001'::uuid,
  jsonb_build_array(
    jsonb_build_object('field_id', 'ffffffff-0000-0000-0000-000000000001', 'value', 'Submitted by field collector'),
    jsonb_build_object('field_id', 'ffffffff-0000-0000-0000-000000000002', 'value', '5')
  ),
  'aaaa1111-0000-0000-0000-000000000099'::uuid
) as collector_response_id \gset

select case when :'collector_response_id' is not null then 'PASS: Data Collector role can submit responses (their actual permitted action)' else 'FAIL' end;

\echo ''
\echo '--- Step 11: Administrator role successfully verifies (positive case, for contrast with Step 10''s rejection) ---'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select verify_response(:'response_id_1'::uuid, 'Confirmed against household register during spot check.');
select status, verified_by is not null as has_verifier, verification_note from form_responses where id = :'response_id_1'::uuid;

reset role;
