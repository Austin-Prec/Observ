-- Seeds 12 responses against the household nutrition survey v2 (which
-- has the gender field), with deliberately known values so every
-- analysis computation this session can be hand-verified against a
-- number I chose myself, not just "some plausible-looking output."
--
-- Design of the numbers (write this down BEFORE checking any analysis
-- code output against it):
--   - 12 responses total: 6 female, 6 male (verified by direct count of
--     the inserts below, not assumed -- an earlier draft of this
--     comment claimed 7/5 without actually re-deriving it from the data
--     being written, which was wrong; corrected after manually
--     re-tallying each respondent's gender/food-security pair)
--   - children_under_5 values: [1,2,3,2,4,1,3,5,2,1,3,2] -- sum=29, mean=29/12=2.41666...
--   - food security: 8 secure, 4 insecure
--   - Cross-tab (gender x food security), re-verified by direct tally:
--     female (A,C,E,G,I,K): secure,insecure,secure,insecure,secure,secure -> 4 secure, 2 insecure
--     male   (B,D,F,H,J,L): secure,secure,secure,insecure,insecure,secure -> 4 secure, 2 insecure
--     (4+4=8 secure, 2+2=4 insecure -- matches the overall totals above)
--   - Mean children_under_5 BY gender:
--     female (A,C,E,G,I,K): [1,3,4,3,2,3] -> sum=16, mean=16/6=2.66666...
--     male   (B,D,F,H,J,L): [2,2,1,5,1,2] -> sum=13, mean=13/6=2.16666...
--     (16+13=29, 6+6=12 -- matches the overall totals above, as a self-check)
--
-- Add a gender field and publish as v2 -- this exercises the "publish a
-- SECOND version" path (the real gap this session found and migration
-- 00006/00007 fixed) as part of the seed itself, rather than requiring
-- a separate manual step run in exactly the right order against a
-- specific hardcoded version id, which is fragile across rebuilds since
-- publish_form() generates a fresh id every time.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into form_fields (id, form_id, field_type, label, sort_order, is_required, options)
values (
  'ffffffff-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000001', 'radio',
  'Respondent gender', 3, true,
  '[{"value":"female","label":"Female"},{"value":"male","label":"Male"},{"value":"other","label":"Other"}]'::jsonb
);

select publish_form('eeeeeeee-0000-0000-0000-000000000001'::uuid) as v2_id \gset

reset role;

-- These are run as the data_collector fixture user via
-- submit_form_response(), the real RPC, not direct table inserts --
-- exercising the actual write path the analysis will read from, same as
-- every other verification this build has done.

set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select submit_form_response(:'v2_id'::uuid, jsonb_build_array(
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000001','value','Respondent A'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000002','value','1'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000003','value','secure'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000004','value','female')
), 'bbbb0001-0000-0000-0000-000000000001'::uuid);

select submit_form_response(:'v2_id'::uuid, jsonb_build_array(
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000001','value','Respondent B'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000002','value','2'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000003','value','secure'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000004','value','male')
), 'bbbb0001-0000-0000-0000-000000000002'::uuid);

select submit_form_response(:'v2_id'::uuid, jsonb_build_array(
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000001','value','Respondent C'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000002','value','3'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000003','value','insecure'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000004','value','female')
), 'bbbb0001-0000-0000-0000-000000000003'::uuid);

select submit_form_response(:'v2_id'::uuid, jsonb_build_array(
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000001','value','Respondent D'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000002','value','2'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000003','value','secure'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000004','value','male')
), 'bbbb0001-0000-0000-0000-000000000004'::uuid);

select submit_form_response(:'v2_id'::uuid, jsonb_build_array(
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000001','value','Respondent E'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000002','value','4'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000003','value','secure'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000004','value','female')
), 'bbbb0001-0000-0000-0000-000000000005'::uuid);

select submit_form_response(:'v2_id'::uuid, jsonb_build_array(
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000001','value','Respondent F'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000002','value','1'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000003','value','secure'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000004','value','male')
), 'bbbb0001-0000-0000-0000-000000000006'::uuid);

select submit_form_response(:'v2_id'::uuid, jsonb_build_array(
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000001','value','Respondent G'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000002','value','3'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000003','value','insecure'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000004','value','female')
), 'bbbb0001-0000-0000-0000-000000000007'::uuid);

select submit_form_response(:'v2_id'::uuid, jsonb_build_array(
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000001','value','Respondent H'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000002','value','5'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000003','value','insecure'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000004','value','male')
), 'bbbb0001-0000-0000-0000-000000000008'::uuid);

select submit_form_response(:'v2_id'::uuid, jsonb_build_array(
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000001','value','Respondent I'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000002','value','2'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000003','value','secure'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000004','value','female')
), 'bbbb0001-0000-0000-0000-000000000009'::uuid);

select submit_form_response(:'v2_id'::uuid, jsonb_build_array(
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000001','value','Respondent J'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000002','value','1'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000003','value','insecure'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000004','value','male')
), 'bbbb0001-0000-0000-0000-000000000010'::uuid);

select submit_form_response(:'v2_id'::uuid, jsonb_build_array(
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000001','value','Respondent K'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000002','value','3'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000003','value','secure'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000004','value','female')
), 'bbbb0001-0000-0000-0000-000000000011'::uuid);

select submit_form_response(:'v2_id'::uuid, jsonb_build_array(
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000001','value','Respondent L'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000002','value','2'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000003','value','secure'),
  jsonb_build_object('field_id','ffffffff-0000-0000-0000-000000000004','value','male')
), 'bbbb0001-0000-0000-0000-000000000012'::uuid);

reset role;
