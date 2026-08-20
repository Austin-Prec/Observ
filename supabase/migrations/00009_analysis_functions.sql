-- ============================================================================
-- 00009_analysis_functions.sql
--
-- Descriptive analysis functions (spec section 5: "Statistical Analysis
-- ... descriptive and inferential statistics" -- this migration covers
-- descriptive only; see the NOT YET BUILT note at the bottom for why
-- inferential statistics like regression are out of scope for this
-- pass). Also covers disaggregation-grouped breakdowns, which spec
-- section 2 calls out as a first-class indicator property and section 5
-- requires analysis to support ("across multiple indicators, projects,
-- and dimensions").
--
-- Design decision: these are SQL functions, not raw ad-hoc queries built
-- client-side. Two reasons:
-- 1. RLS still applies underneath (these are SECURITY INVOKER, not
--    DEFINER -- analysis should never see more than the calling user's
--    normal read access already permits; there's no reason to elevate
--    privilege for a read-only aggregation).
-- 2. The aggregation logic (numeric vs categorical field handling, null
--    handling, grouping) lives in ONE tested place rather than being
--    reimplemented in every chart/table the UI eventually needs. This
--    mirrors the reasoning for submit_form_response and publish_form
--    being RPCs rather than client-orchestrated multi-query sequences.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- field_summary_stats: for a NUMERIC field (number or likert_scale),
-- returns count/mean/min/max/sum. For a non-numeric field, returns a
-- frequency table (value + count) instead -- these are genuinely
-- different shapes of "summary," so this function returns TWO possible
-- result shapes depending on field_type, discriminated by which columns
-- are non-null. This is slightly awkward SQL but avoids either forcing
-- categorical data into a fake "mean" (meaningless) or requiring the
-- caller to already know the field's type before calling (the function
-- itself looks it up and branches).
-- ----------------------------------------------------------------------------

create type field_summary_row as (
  answer_value text,       -- populated for categorical frequency rows; null for the numeric summary row
  response_count bigint,   -- count of non-null answers (numeric) or count for this value (categorical)
  mean_value numeric,       -- populated only for numeric field types
  min_value numeric,
  max_value numeric,
  sum_value numeric
);

create function field_summary_stats(p_field_id uuid)
returns setof field_summary_row
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_field_type field_type;
begin
  select ff.field_type into v_field_type
  from form_fields ff
  where ff.id = p_field_id;

  if v_field_type is null then
    raise exception 'Field % not found', p_field_id;
  end if;

  if v_field_type in ('number', 'likert_scale') then
    return query
      select
        null::text as answer_value,
        count(ra.answer_numeric) as response_count,
        round(avg(ra.answer_numeric), 4) as mean_value,
        min(ra.answer_numeric) as min_value,
        max(ra.answer_numeric) as max_value,
        sum(ra.answer_numeric) as sum_value
      from response_answers ra
      where ra.field_id = p_field_id and ra.answer_numeric is not null;
  else
    -- Categorical (text, dropdown, radio, date, gps, etc): frequency
    -- table. For checkbox fields specifically, answer_value may contain
    -- multiple comma-joined selections (see migration 00005's storage
    -- convention) -- this function deliberately does NOT split those
    -- apart, since "how many respondents selected this EXACT
    -- combination" and "how many respondents selected THIS option among
    -- others" are different, both legitimate questions, and splitting
    -- silently would answer only the second without the caller asking
    -- for it. Noted as a real limitation, not silently handled.
    return query
      select
        ra.answer_value,
        count(*) as response_count,
        null::numeric as mean_value,
        null::numeric as min_value,
        null::numeric as max_value,
        null::numeric as sum_value
      from response_answers ra
      where ra.field_id = p_field_id and ra.answer_value is not null
      group by ra.answer_value
      order by count(*) desc;
  end if;
end;
$$;

comment on function field_summary_stats is 'Numeric fields (number/likert_scale): one row with count/mean/min/max/sum. All other field types: a frequency table, one row per distinct answer_value. Does not split multi-select checkbox values -- see function body comment.';

grant execute on function field_summary_stats to authenticated;

-- ----------------------------------------------------------------------------
-- field_summary_disaggregated: same as field_summary_stats, but grouped
-- by the answer to a SECOND field on the same response (e.g. mean
-- children-under-5 BY gender). Both fields must belong to the same
-- response for the join to mean anything -- enforced by joining through
-- response_answers.response_id, not by any assumption about which form
-- either field belongs to (a respondent could in principle answer two
-- fields from two different forms IF they were somehow on the same
-- response, but the schema ties one form_version_id to one response, so
-- in practice both fields are always on the same form/version -- this
-- function doesn't need to enforce that separately, RLS + the schema's
-- own structure already guarantee it).
-- ----------------------------------------------------------------------------

create type disaggregated_summary_row as (
  group_value text,        -- the disaggregation field's answer (e.g. 'female')
  response_count bigint,
  mean_value numeric,
  min_value numeric,
  max_value numeric,
  sum_value numeric
);

create function field_summary_disaggregated(p_field_id uuid, p_group_by_field_id uuid)
returns setof disaggregated_summary_row
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_field_type field_type;
begin
  select ff.field_type into v_field_type
  from form_fields ff
  where ff.id = p_field_id;

  if v_field_type is null then
    raise exception 'Field % not found', p_field_id;
  end if;

  if v_field_type not in ('number', 'likert_scale') then
    raise exception 'field_summary_disaggregated requires a numeric field (number or likert_scale); % is %', p_field_id, v_field_type;
  end if;

  return query
    select
      group_answer.answer_value as group_value,
      count(value_answer.answer_numeric) as response_count,
      round(avg(value_answer.answer_numeric), 4) as mean_value,
      min(value_answer.answer_numeric) as min_value,
      max(value_answer.answer_numeric) as max_value,
      sum(value_answer.answer_numeric) as sum_value
    from response_answers value_answer
    join response_answers group_answer on group_answer.response_id = value_answer.response_id
    where value_answer.field_id = p_field_id
      and group_answer.field_id = p_group_by_field_id
      and value_answer.answer_numeric is not null
    group by group_answer.answer_value
    order by group_answer.answer_value;
end;
$$;

comment on function field_summary_disaggregated is 'Mean/min/max/sum of a numeric field, grouped by the answer to a second (typically categorical, e.g. gender/location) field on the same response. Raises if p_field_id is not numeric.';

grant execute on function field_summary_disaggregated to authenticated;

-- ----------------------------------------------------------------------------
-- cross_tabulation: frequency count for every combination of two
-- categorical fields' answers (e.g. gender x food-security-status). This
-- is the "pivot ... across multiple ... dimensions" capability from spec
-- section 5, scoped to two dimensions -- an N-dimensional pivot is a
-- genuinely different, more complex feature (see NOT YET BUILT).
-- ----------------------------------------------------------------------------

create type cross_tab_row as (
  row_value text,
  column_value text,
  cell_count bigint
);

create function cross_tabulation(p_row_field_id uuid, p_column_field_id uuid)
returns setof cross_tab_row
language sql
security invoker
stable
set search_path = public
as $$
  select
    row_answer.answer_value as row_value,
    col_answer.answer_value as column_value,
    count(*) as cell_count
  from response_answers row_answer
  join response_answers col_answer on col_answer.response_id = row_answer.response_id
  where row_answer.field_id = p_row_field_id
    and col_answer.field_id = p_column_field_id
    and row_answer.answer_value is not null
    and col_answer.answer_value is not null
  group by row_answer.answer_value, col_answer.answer_value
  order by row_answer.answer_value, col_answer.answer_value;
$$;

comment on function cross_tabulation is 'Two-dimensional frequency table: count of responses for every (row_field answer, column_field answer) combination.';

grant execute on function cross_tabulation to authenticated;

-- ----------------------------------------------------------------------------
-- NOT YET BUILT, noted explicitly:
-- - Inferential statistics (regression, significance testing) -- spec
--   section 5 lists this separately from descriptive stats. Genuinely
--   out of scope for this pass: correctly implementing and VERIFYING
--   regression (the standard this build has held every other piece to)
--   needs real statistical validation against known datasets, which is
--   a substantially larger effort than the descriptive functions above
--   and would not have gotten that same verification rigor if rushed
--   into this same session.
-- - Geospatial analysis / thematic maps (spec section 5) -- form_responses
--   has latitude/longitude columns (migration 00005) but nothing in this
--   migration aggregates or maps them.
-- - Custom formula engine / calculated indices (spec section 5).
-- - N-dimensional pivot (more than 2 grouping dimensions at once).
-- - Export to SPSS/Stata/Excel (spec section 5) -- CSV export of these
--   function results is a reasonable next step, not attempted here.
-- - These functions read response_answers.answer_value/answer_numeric
--   directly -- they do NOT filter by form_responses.status. A
--   'flagged' or 'rejected' response's answers are included in these
--   stats exactly the same as a 'verified' one. Whether analysis should
--   exclude flagged/rejected data is a real product decision this
--   migration does not make -- noted rather than silently defaulted.
-- ============================================================================
