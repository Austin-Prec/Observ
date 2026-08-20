-- Seed two organizations, each with one admin user, entirely as postgres
-- (bypassing RLS for setup, which is correct -- RLS should only be
-- evaluated once we switch to querying AS each user, not during fixture
-- creation).

-- Insert into auth.users only -- the handle_new_auth_user trigger (from
-- migration 00001) should fire automatically and create the matching
-- public.profiles row. Manually inserting into both tables, as an
-- earlier version of this seed script did, would have silently worked
-- around the trigger instead of testing it.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'admin@org-a.test', '{"full_name": "Org A Admin"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'admin@org-b.test', '{"full_name": "Org B Admin"}'::jsonb);

insert into organizations (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A', 'org-a'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Org B', 'org-b');

insert into memberships (organization_id, user_id, role, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrator', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'administrator', 'active');

-- A data_collector-role user in Org A, distinct from the administrator
-- above, specifically to test role-boundary enforcement (e.g. "a Data
-- Collector cannot verify their own submission") -- a fixture with only
-- one user per org, always an administrator, cannot exercise that
-- boundary at all, since an administrator legitimately can do
-- everything. Added after a first test pass flagged this gap explicitly
-- rather than silently passing a check that wasn't actually testing what
-- it claimed to.
insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333333', 'collector@org-a.test', '{"full_name": "Org A Field Collector"}'::jsonb);

insert into memberships (organization_id, user_id, role, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'data_collector', 'active');

-- One project + indicator per org, so there is real, non-empty data in
-- each tenant to attempt (and fail) to cross into.
insert into projects (id, organization_id, name, created_by) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Org A Nutrition Program', '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'Org B WASH Program', '22222222-2222-2222-2222-222222222222');

insert into indicators (organization_id, name, indicator_type, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A Confidential Indicator', 'quantitative', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Org B Confidential Indicator', 'quantitative', '22222222-2222-2222-2222-222222222222');

-- A published form with real fields, as a reusable fixture for testing
-- form_responses/response_answers (migration 00005) and anything built
-- on top of them later (analysis, reports). Built directly as postgres
-- (bypassing RLS/publish_form's permission check, which is fine here --
-- this is fixture setup, not a test of that function) rather than via
-- the actual publish_form() RPC, specifically so this fixture doesn't
-- silently depend on that function continuing to behave a particular
-- way; the RLS/publish_form/immutability behaviors themselves are
-- already covered by the dedicated test scripts, not by this seed.
insert into forms (id, organization_id, project_id, name, status, current_version, created_by) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Household Nutrition Survey', 'published', 1, '11111111-1111-1111-1111-111111111111');

insert into form_versions (id, form_id, version, published_by) values
  ('11111111-aaaa-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 1, '11111111-1111-1111-1111-111111111111');

insert into form_fields (id, form_id, form_version_id, field_type, label, sort_order, is_required, options) values
  ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', '11111111-aaaa-0000-0000-000000000001', 'text', 'Household head name', 0, true, '[]'::jsonb),
  ('ffffffff-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', '11111111-aaaa-0000-0000-000000000001', 'number', 'Number of children under 5', 1, true, '[]'::jsonb),
  ('ffffffff-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000001', '11111111-aaaa-0000-0000-000000000001', 'dropdown', 'Household food security status', 2, false,
    '[{"value":"secure","label":"Food secure"},{"value":"insecure","label":"Food insecure"}]'::jsonb);

-- form_version_fields entries for this fixture's v1, mirroring the
-- direct-insert-not-via-RPC approach used above for forms/form_versions/
-- form_fields. Required specifically because 00007's backfill migration
-- can only backfill data that already existed in the schema at the
-- moment IT ran -- in a real deployment that's any pre-existing
-- production form, but in this test harness, seed fixtures are created
-- by a script that necessarily runs AFTER all migrations (migrations
-- always apply before fixtures), so 00007 could never have seen this
-- fixture's fields to backfill them. Found by running the full pipeline
-- end to end and getting a "field not part of this version" error on a
-- v2 submission despite 00006/00007/00008 all being independently
-- confirmed correct in isolation -- the gap was here, in fixture setup,
-- not in any of those three migrations.
insert into form_version_fields (form_version_id, field_id, sort_order) values
  ('11111111-aaaa-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 0),
  ('11111111-aaaa-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000002', 1),
  ('11111111-aaaa-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000003', 2);
