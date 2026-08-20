# Observ — Foundation + Forms + Data Collection + Analysis (DB layer)

Five layers deep: **multi-tenant foundation**, **form builder**, **data
collection** (real submissions), **verification workflow**, and
**descriptive analysis functions** (database layer only — no UI yet,
see below).

## The most important thing to know about this session

While seeding a realistic dataset to test analysis against, I found a
**real, previously-undiscovered bug**: republishing a form (adding a
field to an already-published form and publishing again) only included
the NEW field in the new version — every pre-existing field silently
disappeared from the live version. In production, this would have meant
adding one question to a live form would have caused the actual data
entry screen to stop asking every other question, with no error, no
warning.

This was never caught in three prior sessions because no prior session
had ever actually republished a form a second time — every previous
test only ever published once. It surfaced the moment this session
tried to do the ordinary thing of adding a field to an existing form.

Root cause: `form_fields.form_version_id` modeled "which version does
this field belong to" as one field → exactly one version. That's wrong —
a field belongs to every version from when it was first published
onward, until deliberately removed. Fixed properly (migrations
00006–00008): a new `form_version_fields` many-to-many join table,
`publish_form()` corrected to carry forward existing fields, a backfill
for versions that predate the fix, and — found only by then actually
testing a submission against the fixed version — `submit_form_response()`
had the *exact same* single-version assumption in a third location,
also fixed. A systematic grep confirmed no other location has the same
pattern.

This is the clearest evidence yet for why this build tests everything
against a live database rather than trusting a schema read: this bug
would have shipped invisibly.

## What's new this session

- **`form_responses` + `response_answers`** (migration 00005): atomic,
  idempotent submission via `submit_form_response()`. Verification
  workflow (`verify_response()`/`flag_response()`) with a genuine
  role-boundary test — a `data_collector` cannot verify their own
  submission, confirmed server-side, not just hidden in the UI.
- **Data entry UI**: a real form for 8 of 12 field types. The other 4
  (photo/file upload, signature, barcode/QR) need real device APIs this
  build doesn't have a way to verify, so they show an honest "not yet
  implemented" placeholder rather than a fake-looking input that
  silently drops data.
- **`form_version_fields`** (migrations 00006–00008): the versioning fix
  described above.
- **Analysis functions** (migration 00009): `field_summary_stats`
  (numeric mean/min/max/sum, or a frequency table for categorical
  fields), `field_summary_disaggregated` (numeric summary grouped by a
  second field — e.g. mean children-under-5 by gender), `cross_tabulation`
  (2D frequency table). All `SECURITY INVOKER` so RLS genuinely applies —
  confirmed Org B cannot see Org A's data through these functions, not
  just assumed.

## What's verified vs. what isn't

Every migration, every function, in this session was run against a real
local Postgres 16 instance and checked against real data — including a
hand-verified 12-response dataset (seeded via the real
`submit_form_response()` RPC, not direct table inserts) with numbers I
calculated by hand and cross-checked with `bc` before trusting them as
ground truth. Every analysis function's output was confirmed to match
that ground truth exactly: overall mean 2.4167, disaggregated means
2.6667 (female, n=6) and 2.1667 (male, n=6), cross-tab counts of
4/2/4/2. Not "a number came out and looked plausible" — an exact match
against a number I derived independently first.

Worth being direct about the cost of this rigor: finding and properly
fixing the versioning bug took most of this session, including two
wrong hypotheses along the way (once assuming a Postgres restart hadn't
disturbed test state when it had; once misdiagnosing a fixture ID
collision as a schema regression). Both are documented in the
migrations/commit history for anyone who wants the full trace, not
smoothed over.

**Analysis has NO UI yet.** The three functions above are written,
migrated, and verified at the database layer, with TypeScript types
added to `database.types.ts` and confirmed to type-check/build/lint
clean — but there is no screen that calls them. That's the honest state
to hand off, rather than a rushed UI built without the same verification
discipline as everything else in this build.

## What this is not (yet)

- **Analysis UI** — the functions exist, nothing calls them from a
  screen yet.
- **Inferential statistics** (regression, significance testing) — spec
  §5 lists this separately from descriptive stats. Correctly
  implementing AND verifying this needs real statistical validation
  against known datasets; genuinely out of scope for a session that also
  needed to find and fix the versioning bug above.
- **Geospatial analysis / thematic maps** — `form_responses` has
  latitude/longitude (migration 00005) but nothing aggregates or maps it.
- **Custom formula engine**, **N-dimensional pivot** (current cross-tab
  is 2D only), **SPSS/Stata/Excel export**.
- **Report builder, scheduling, data storytelling** (spec §6) — not
  started.
- **Whether flagged/rejected responses should be excluded from
  analysis** — a real, undecided product question, flagged directly in
  migration 00009 rather than silently defaulted. Right now, analysis
  functions include ALL responses regardless of verification status.
- Everything listed as not-yet-built in the prior README entries still
  applies (offline mode, mobile app, editing/correcting submitted
  answers, revising a published form's carry-forward-or-not choice per
  field, etc).

## Local setup

```bash
npm install
cp .env.local.example .env.local   # fill in real Supabase project values
npm run dev
```

Migrations apply in order (`00001` → `00009`). Test fixtures and
functional test suites are in `supabase/testing/` — including
`seed_analysis_dataset.sql`, which is the verified ground-truth dataset
referenced above and a reasonable template for testing any future
analysis feature the same way.
