-- ============================================================================
-- RLS cross-tenant isolation test.
--
-- This connects as the `authenticated` role (not postgres) and sets the
-- session's identity to Org A's admin user via the same mechanism
-- auth.uid() reads in production (a JWT claim, here simulated via a
-- session config var). Every query below runs through RLS exactly as it
-- would for a real client -- this is not `select * from ... as postgres`,
-- which would bypass RLS and prove nothing.
-- ============================================================================

\echo '=== Switching identity to Org A admin (11111111-...-1111) ==='
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '--- Check 1: Org A admin should see exactly 1 organization (their own) ---'
select count(*) as orgs_visible, count(*) filter (where id = 'aaaaaaaa-0000-0000-0000-000000000001') as org_a_visible, count(*) filter (where id = 'bbbbbbbb-0000-0000-0000-000000000002') as org_b_visible
from organizations;

\echo ''
\echo '--- Check 2: Org A admin should see exactly 1 project (their own), NOT Org B''s ---'
select count(*) as projects_visible, count(*) filter (where name = 'Org A Nutrition Program') as org_a_project_visible, count(*) filter (where name = 'Org B WASH Program') as org_b_project_visible
from projects;

\echo ''
\echo '--- Check 3: Org A admin should see exactly 1 indicator (their own), NOT Org B''s ---'
select count(*) as indicators_visible, count(*) filter (where name = 'Org A Confidential Indicator') as org_a_indicator_visible, count(*) filter (where name = 'Org B Confidential Indicator') as org_b_indicator_visible
from indicators;

\echo ''
\echo '--- Check 4: direct attempt to read Org B''s project by known ID (simulates a client guessing/leaking an ID) ---'
select count(*) as rows_returned
from projects
where id = 'dddddddd-0000-0000-0000-000000000002';

\echo ''
\echo '--- Check 5: Org A admin attempts to INSERT a project into Org B''s org directly ---'
do $$
begin
  begin
    insert into projects (organization_id, name, created_by)
    values ('bbbbbbbb-0000-0000-0000-000000000002', 'Malicious cross-org insert', '11111111-1111-1111-1111-111111111111');
    raise notice 'FAIL: insert into another org succeeded -- this should have been rejected by RLS';
  exception when others then
    raise notice 'PASS: insert into another org was rejected (%)', sqlerrm;
  end;
end $$;

\echo ''
\echo '=== Switching identity to Org B admin (22222222-...-2222), repeating Check 2 from the other side ==='
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

\echo ''
\echo '--- Check 6: Org B admin should see exactly 1 project (their own), NOT Org A''s ---'
select count(*) as projects_visible, count(*) filter (where name = 'Org B WASH Program') as org_b_project_visible, count(*) filter (where name = 'Org A Nutrition Program') as org_a_project_visible
from projects;

\echo ''
\echo '=== Check 7: audit log immutability -- attempt UPDATE and DELETE as an authenticated user, both must genuinely leave the row unchanged ==='
-- Grant UPDATE/DELETE explicitly for this check (real deployments should
-- never grant these -- see migration 00002 -- but the point of this
-- check is to prove immutability holds even if that grant were ever
-- accidentally introduced later, not merely that today's grants happen
-- to be absent).
grant update, delete on audit_logs to authenticated;

select write_audit_log(
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'login'::audit_action,
  null, null, '{}'::jsonb, null, null
) as new_audit_log_id \gset

-- IMPORTANT: Postgres RLS policies do not raise an error on UPDATE/DELETE
-- when a row is filtered out by a `using (false)` policy -- the row is
-- just silently excluded from the match, same as SELECT. An earlier
-- version of this test asserted on exception-raised, which is wrong per
-- Postgres's own documentation and produced a false FAIL during
-- development. The correct assertion (also what Supabase's own RLS
-- testing docs prescribe) is: use RETURNING and check whether any row
-- actually came back, not whether an error was thrown.
with attempt as (
  update audit_logs
  set metadata = '{"tampered": true}'::jsonb
  where id = :'new_audit_log_id'::uuid
  returning id
)
select
  case when count(*) = 0 then 'PASS: UPDATE matched 0 rows (row unchanged)' else 'FAIL: UPDATE modified ' || count(*) || ' row(s)' end as update_result
from attempt;

with attempt as (
  delete from audit_logs
  where id = :'new_audit_log_id'::uuid
  returning id
)
select
  case when count(*) = 0 then 'PASS: DELETE matched 0 rows (row unchanged)' else 'FAIL: DELETE removed ' || count(*) || ' row(s)' end as delete_result
from attempt;

reset role;
revoke update, delete on audit_logs from authenticated;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- Final, independent confirmation as postgres (bypasses RLS, so this
-- checks ground truth): is the row still exactly as written?
reset role;
select
  case when metadata = '{}'::jsonb then 'PASS: row content confirmed unchanged by postgres (ground truth)' else 'FAIL: row was actually modified -- metadata = ' || metadata::text end as ground_truth_check
from audit_logs where id = :'new_audit_log_id'::uuid;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '=== Check 8: Org A admin attempts to read audit_logs -- should see ONLY Org A rows (currently zero, none written for Org A) ==='
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select count(*) as org_a_audit_rows_visible, count(*) filter (where organization_id = 'bbbbbbbb-0000-0000-0000-000000000002') as org_b_rows_leaked
from audit_logs;

reset role;
