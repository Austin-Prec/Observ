-- ============================================================================
-- 00003_indicators_and_logframe.sql
-- Projects, Logframe hierarchy, and Indicator library.
--
-- Modeling decisions:
-- - `logframe_results` is a single self-referencing table (goal/purpose/
--   output/activity all live here, linked by parent_id) rather than four
--   separate tables. A results chain is fundamentally a tree of the same
--   shape at every level -- separate tables would mean duplicating every
--   RLS policy and every future column four times over, and would make
--   "show me the full chain for this project" four joins instead of one
--   recursive query.
-- - `indicators` are NOT owned by a single logframe_result. Per the spec,
--   indicators live in a reusable, centralized library, and are attached
--   to results via a join table (`indicator_results`). The same indicator
--   (e.g. "% of participants who are women") can be reused across many
--   projects and many levels without duplicating its definition.
-- - Disaggregation categories are modeled as their own table plus a join
--   table rather than a jsonb array on indicators, because disaggregated
--   VALUES (the actual data broken down by gender/age/location) need to
--   reference specific categories relationally once data collection
--   exists -- a jsonb array can't be a foreign key target.
-- ============================================================================

create type indicator_type as enum ('quantitative', 'qualitative');

create type result_level as enum ('goal', 'purpose', 'output', 'activity');

-- ----------------------------------------------------------------------------
-- Projects
-- ----------------------------------------------------------------------------

create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('planning', 'active', 'closed', 'archived')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_dates_sane check (end_date is null or start_date is null or end_date >= start_date)
);

comment on table projects is 'A program/project. Each has its own logframe and scoped data collection.';

create index idx_projects_org on projects(organization_id);

create trigger trg_projects_updated_at
  before update on projects
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- Logframe results (Goal / Purpose / Output / Activity), self-referencing
-- ----------------------------------------------------------------------------

create table logframe_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references logframe_results(id) on delete cascade,
  level result_level not null,
  statement text not null,
  -- Assumptions/risks are a standard logframe column (the 4th column in
  -- the classic 4x4 matrix, alongside indicators/means of verification).
  assumptions text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table logframe_results is 'Self-referencing tree: Goal -> Purpose -> Output -> Activity. Level ordering is validated by trg_logframe_level_hierarchy.';

create index idx_logframe_results_project on logframe_results(project_id);
create index idx_logframe_results_parent on logframe_results(parent_id);

create trigger trg_logframe_results_updated_at
  before update on logframe_results
  for each row execute function set_updated_at();

-- Enforce that parent/child levels follow the correct hierarchy
-- (goal has no parent; purpose's parent must be a goal; output's parent
-- must be a purpose; activity's parent must be an output). Without this,
-- nothing stops a UI bug from attaching an Activity directly under a
-- Goal, which would silently corrupt every results-chain visualization
-- built on top of this table later.
create function check_logframe_hierarchy()
returns trigger
language plpgsql
as $$
declare
  v_parent_level result_level;
begin
  if new.level = 'goal' then
    if new.parent_id is not null then
      raise exception 'A Goal-level result cannot have a parent.';
    end if;
    return new;
  end if;

  if new.parent_id is null then
    raise exception '% level results must have a parent.', new.level;
  end if;

  select level into v_parent_level
  from logframe_results
  where id = new.parent_id;

  if v_parent_level is null then
    raise exception 'Parent result % not found.', new.parent_id;
  end if;

  if new.level = 'purpose' and v_parent_level != 'goal' then
    raise exception 'Purpose-level results must have a Goal-level parent, got %.', v_parent_level;
  elsif new.level = 'output' and v_parent_level != 'purpose' then
    raise exception 'Output-level results must have a Purpose-level parent, got %.', v_parent_level;
  elsif new.level = 'activity' and v_parent_level != 'output' then
    raise exception 'Activity-level results must have an Output-level parent, got %.', v_parent_level;
  end if;

  return new;
end;
$$;

create trigger trg_logframe_level_hierarchy
  before insert or update of level, parent_id on logframe_results
  for each row execute function check_logframe_hierarchy();

-- ----------------------------------------------------------------------------
-- Disaggregation categories (e.g. Gender, Age Group, Location) and their
-- values (e.g. Male/Female/Other under Gender). Reusable across the org,
-- same rationale as the indicator library itself.
-- ----------------------------------------------------------------------------

create table disaggregation_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table disaggregation_values (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references disaggregation_categories(id) on delete cascade,
  value text not null,
  sort_order integer not null default 0,
  unique (category_id, value)
);

create index idx_disagg_values_category on disaggregation_values(category_id);

-- ----------------------------------------------------------------------------
-- Indicator library: centralized, reusable indicator definitions.
-- ----------------------------------------------------------------------------

create table indicators (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  indicator_type indicator_type not null,
  unit_of_measure text,
  baseline_value numeric,
  baseline_date date,
  target_value numeric,
  target_date date,
  data_source text,
  -- Frequency as a constrained set of common M&E cadences, plus 'custom'
  -- as an escape hatch, rather than a bare text field -- this becomes a
  -- filter/group-by dimension in the analysis module later, and free
  -- text ("quarterly" vs "Quarterly" vs "every 3 months") would make
  -- that filtering unreliable.
  frequency text not null default 'quarterly'
    check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'biannual', 'annual', 'custom')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint indicators_qualitative_no_numeric_target check (
    indicator_type = 'quantitative' or (baseline_value is null and target_value is null)
  )
);

comment on table indicators is 'Centralized, reusable indicator library, scoped to the organization. Attached to logframe results via indicator_results.';

create index idx_indicators_org on indicators(organization_id);

create trigger trg_indicators_updated_at
  before update on indicators
  for each row execute function set_updated_at();

-- Which disaggregation categories apply to a given indicator (e.g. this
-- indicator should be broken down by Gender and Location, but not Age).
create table indicator_disaggregations (
  indicator_id uuid not null references indicators(id) on delete cascade,
  category_id uuid not null references disaggregation_categories(id) on delete cascade,
  primary key (indicator_id, category_id)
);

-- Join table: which indicators measure which logframe results. Many-to-
-- many because the same indicator can measure multiple results, and a
-- result is typically measured by multiple indicators.
create table indicator_results (
  indicator_id uuid not null references indicators(id) on delete cascade,
  result_id uuid not null references logframe_results(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (indicator_id, result_id)
);

-- ----------------------------------------------------------------------------
-- Row Level Security
--
-- Pattern for all four tables below: SELECT is open to any org member
-- (M&E frameworks need to be broadly readable -- an Enumerator filling
-- out a form still needs to see what indicator they're collecting data
-- against). INSERT/UPDATE/DELETE is restricted to Administrator/Manager
-- roles, via the auth_can_manage_org() helper from 00001, so this stays
-- consistent even if the role hierarchy changes later.
-- ----------------------------------------------------------------------------

alter table projects enable row level security;
alter table logframe_results enable row level security;
alter table disaggregation_categories enable row level security;
alter table disaggregation_values enable row level security;
alter table indicators enable row level security;
alter table indicator_disaggregations enable row level security;
alter table indicator_results enable row level security;

-- Projects
drop policy if exists projects_select_members on projects;
create policy projects_select_members on projects
  for select using (auth_is_member_of_org(organization_id));

drop policy if exists projects_write_managers on projects;
create policy projects_write_managers on projects
  for all
  using (auth_can_manage_org(organization_id))
  with check (auth_can_manage_org(organization_id));

-- Logframe results (org derived from the parent project's org, checked
-- via the project row directly rather than duplicating organization_id
-- trust -- organization_id here is a denormalized convenience column for
-- indexing/filtering, but access control follows the FK relationship).
drop policy if exists logframe_results_select_members on logframe_results;
create policy logframe_results_select_members on logframe_results
  for select using (auth_is_member_of_org(organization_id));

drop policy if exists logframe_results_write_managers on logframe_results;
create policy logframe_results_write_managers on logframe_results
  for all
  using (auth_can_manage_org(organization_id))
  with check (auth_can_manage_org(organization_id));

-- Disaggregation categories/values
drop policy if exists disagg_categories_select_members on disaggregation_categories;
create policy disagg_categories_select_members on disaggregation_categories
  for select using (auth_is_member_of_org(organization_id));

drop policy if exists disagg_categories_write_managers on disaggregation_categories;
create policy disagg_categories_write_managers on disaggregation_categories
  for all
  using (auth_can_manage_org(organization_id))
  with check (auth_can_manage_org(organization_id));

drop policy if exists disagg_values_select_members on disaggregation_values;
create policy disagg_values_select_members on disaggregation_values
  for select using (
    exists (
      select 1 from disaggregation_categories c
      where c.id = disaggregation_values.category_id
        and auth_is_member_of_org(c.organization_id)
    )
  );

drop policy if exists disagg_values_write_managers on disaggregation_values;
create policy disagg_values_write_managers on disaggregation_values
  for all
  using (
    exists (
      select 1 from disaggregation_categories c
      where c.id = disaggregation_values.category_id
        and auth_can_manage_org(c.organization_id)
    )
  )
  with check (
    exists (
      select 1 from disaggregation_categories c
      where c.id = disaggregation_values.category_id
        and auth_can_manage_org(c.organization_id)
    )
  );

-- Indicators
drop policy if exists indicators_select_members on indicators;
create policy indicators_select_members on indicators
  for select using (auth_is_member_of_org(organization_id));

drop policy if exists indicators_write_managers on indicators;
create policy indicators_write_managers on indicators
  for all
  using (auth_can_manage_org(organization_id))
  with check (auth_can_manage_org(organization_id));

-- Join tables: access follows the indicator's org.
drop policy if exists indicator_disagg_select_members on indicator_disaggregations;
create policy indicator_disagg_select_members on indicator_disaggregations
  for select using (
    exists (
      select 1 from indicators i
      where i.id = indicator_disaggregations.indicator_id
        and auth_is_member_of_org(i.organization_id)
    )
  );

drop policy if exists indicator_disagg_write_managers on indicator_disaggregations;
create policy indicator_disagg_write_managers on indicator_disaggregations
  for all
  using (
    exists (
      select 1 from indicators i
      where i.id = indicator_disaggregations.indicator_id
        and auth_can_manage_org(i.organization_id)
    )
  )
  with check (
    exists (
      select 1 from indicators i
      where i.id = indicator_disaggregations.indicator_id
        and auth_can_manage_org(i.organization_id)
    )
  );

drop policy if exists indicator_results_select_members on indicator_results;
create policy indicator_results_select_members on indicator_results
  for select using (
    exists (
      select 1 from indicators i
      where i.id = indicator_results.indicator_id
        and auth_is_member_of_org(i.organization_id)
    )
  );

drop policy if exists indicator_results_write_managers on indicator_results;
create policy indicator_results_write_managers on indicator_results
  for all
  using (
    exists (
      select 1 from indicators i
      where i.id = indicator_results.indicator_id
        and auth_can_manage_org(i.organization_id)
    )
  )
  with check (
    exists (
      select 1 from indicators i
      where i.id = indicator_results.indicator_id
        and auth_can_manage_org(i.organization_id)
    )
  );

-- Grants (baseline table privileges; RLS above still governs row access).
grant select, insert, update, delete on projects to authenticated;
grant select, insert, update, delete on logframe_results to authenticated;
grant select, insert, update, delete on disaggregation_categories to authenticated;
grant select, insert, update, delete on disaggregation_values to authenticated;
grant select, insert, update, delete on indicators to authenticated;
grant select, insert, update, delete on indicator_disaggregations to authenticated;
grant select, insert, update, delete on indicator_results to authenticated;
