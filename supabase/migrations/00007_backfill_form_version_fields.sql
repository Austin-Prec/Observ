-- ============================================================================
-- 00007_backfill_form_version_fields.sql
--
-- Migration 00006 introduced form_version_fields but only maintains it
-- going forward, via publish_form(). Any form_versions row that already
-- existed before 00006 ran has no form_version_fields entries at all --
-- discovered immediately after writing 00006, when re-publishing a v1
-- form created before this migration existed produced a v2 with zero
-- carried-forward fields (the exact bug 00006 was meant to fix,
-- resurfacing for a different reason: not "carry-forward logic is
-- wrong" but "there is nothing to carry forward from, because v1 never
-- had form_version_fields rows in the first place").
--
-- This migration backfills form_version_fields for every EXISTING
-- form_versions row, using form_fields.form_version_id as the only
-- available signal for "which fields belonged to this version" -- which
-- is exactly the old (00004-era), single-version-per-field assumption.
-- That's fine here specifically BECAUSE this only runs once, against
-- whatever versions already exist at the moment 00006/00007 are first
-- applied: any version created before 00006 only ever had one version
-- per field under the old model anyway, so backfilling from that model
-- is not lossy for pre-existing data. Every version created AFTER 00006
-- is populated by the corrected publish_form(), not by this backfill.
-- ============================================================================

insert into form_version_fields (form_version_id, field_id, sort_order)
select ff.form_version_id, ff.id, ff.sort_order
from form_fields ff
where ff.form_version_id is not null
on conflict (form_version_id, field_id) do nothing;
