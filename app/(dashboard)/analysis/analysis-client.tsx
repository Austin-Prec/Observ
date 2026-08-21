"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

type FieldOption = { id: string; label: string; field_type: string };
type FormOption = { id: string; name: string; current_version: number };

const NUMERIC_TYPES = new Set(["number", "likert_scale"]);

export function AnalysisClient({
  forms,
  fieldsByForm,
}: {
  forms: FormOption[];
  fieldsByForm: Record<string, FieldOption[]>;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [formId, setFormId] = useState<string>(forms[0]?.id ?? "");
  const [fieldId, setFieldId] = useState<string>("");
  const [groupByFieldId, setGroupByFieldId] = useState<string>("");

  const fields = fieldsByForm[formId] ?? [];

  // A fieldId selected under a PREVIOUS form has no meaning once the
  // form changes -- rather than an effect that resets state as a side
  // effect of formId changing (React's react-hooks/set-state-in-effect
  // rule correctly flags that pattern: it causes an extra render and
  // the two pieces of state can transiently disagree), the selection is
  // validated on every read instead. If the stored id isn't in the
  // current form's field list, it's treated as empty -- computed
  // directly, not synchronized via a side effect.
  const validFieldId = fields.some((f) => f.id === fieldId) ? fieldId : "";
  const validGroupByFieldId = fields.some((f) => f.id === groupByFieldId) ? groupByFieldId : "";

  const selectedField = fields.find((f) => f.id === validFieldId);
  const groupByField = fields.find((f) => f.id === validGroupByFieldId);
  const isNumericField = selectedField ? NUMERIC_TYPES.has(selectedField.field_type) : false;

  return (
    <div>
      <header className="border-b px-8 py-5" style={{ borderColor: "var(--line)" }}>
        <div
          className="text-xs tracking-[0.2em] uppercase mb-0.5"
          style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}
        >
          Analysis
        </div>
        <h1 className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
          Summary statistics
        </h1>
      </header>

      <main className="px-8 py-8 max-w-3xl mx-auto">
        {forms.length === 0 ? (
          <div
            className="border rounded-sm p-8 text-center"
            style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
          >
            <p className="text-sm" style={{ color: "#6b6558" }}>
              No published forms yet. Analysis needs a published form with
              collected responses to summarize.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <Picker
                label="Form"
                value={formId}
                onChange={setFormId}
                options={forms.map((f) => ({ value: f.id, label: f.name }))}
              />
              <Picker
                label="Field"
                value={validFieldId}
                onChange={setFieldId}
                options={fields.map((f) => ({ value: f.id, label: f.label }))}
                placeholder="Select a field…"
                disabled={fields.length === 0}
              />
            </div>

            {validFieldId && (
              <div className="mb-6">
                <Picker
                  label="Break down by (optional)"
                  value={validGroupByFieldId}
                  onChange={setGroupByFieldId}
                  options={fields
                    .filter((f) => f.id !== validFieldId)
                    .map((f) => ({ value: f.id, label: f.label }))}
                  placeholder="No breakdown"
                  allowEmpty
                />
              </div>
            )}

            {validFieldId && selectedField && (
              <ResultsPanel
                supabase={supabase}
                fieldId={validFieldId}
                fieldLabel={selectedField.label}
                isNumericField={isNumericField}
                groupByFieldId={validGroupByFieldId || null}
                groupByLabel={groupByField?.label ?? null}
                groupByIsNumeric={groupByField ? NUMERIC_TYPES.has(groupByField.field_type) : false}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Picker({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  allowEmpty,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
}) {
  return (
    <div>
      <label
        className="block text-xs uppercase tracking-wide mb-1.5"
        style={{ fontFamily: "var(--font-mono)", color: "#6b6558" }}
      >
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2.5 rounded-sm border outline-none focus:ring-2 disabled:opacity-50"
        style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
      >
        {(placeholder || allowEmpty) && <option value="">{placeholder ?? "Select…"}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

type NumericSummary = {
  response_count: number;
  mean_value: number | null;
  min_value: number | null;
  max_value: number | null;
  sum_value: number | null;
};

type FrequencyRow = { answer_value: string | null; response_count: number };
type DisaggRow = {
  group_value: string | null;
  response_count: number;
  mean_value: number | null;
};
type CrossTabRow = { row_value: string | null; column_value: string | null; cell_count: number };

function ResultsPanel({
  supabase,
  fieldId,
  fieldLabel,
  isNumericField,
  groupByFieldId,
  groupByLabel,
  groupByIsNumeric,
}: {
  supabase: ReturnType<typeof createClient>;
  fieldId: string;
  fieldLabel: string;
  isNumericField: boolean;
  groupByFieldId: string | null;
  groupByLabel: string | null;
  groupByIsNumeric: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numericSummary, setNumericSummary] = useState<NumericSummary | null>(null);
  const [frequencyRows, setFrequencyRows] = useState<FrequencyRow[]>([]);
  const [disaggRows, setDisaggRows] = useState<DisaggRow[]>([]);
  const [crossTabRows, setCrossTabRows] = useState<CrossTabRow[]>([]);

  // Determines which of the three verified RPCs to call, based on the
  // combination of (is the primary field numeric?) x (is a group-by
  // field selected, and is IT numeric?). Mirrors exactly what
  // field_summary_disaggregated's own guard enforces server-side
  // (migration 00009: it raises if the target field isn't numeric) --
  // this client-side branching exists to pick the RIGHT call, not to
  // duplicate that validation; the server-side check is still what
  // actually protects against a wrong call slipping through.
  const mode = !groupByFieldId
    ? "plain"
    : isNumericField
      ? "disaggregated"
      : "cross_tab";

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      setNumericSummary(null);
      setFrequencyRows([]);
      setDisaggRows([]);
      setCrossTabRows([]);

      if (mode === "plain") {
        const { data, error: rpcError } = await supabase.rpc("field_summary_stats", {
          p_field_id: fieldId,
        });
        if (cancelled) return;
        if (rpcError) {
          setError(rpcError.message);
        } else if (isNumericField) {
          setNumericSummary((data?.[0] as NumericSummary) ?? null);
        } else {
          setFrequencyRows((data as FrequencyRow[]) ?? []);
        }
      } else if (mode === "disaggregated") {
        const { data, error: rpcError } = await supabase.rpc("field_summary_disaggregated", {
          p_field_id: fieldId,
          p_group_by_field_id: groupByFieldId!,
        });
        if (cancelled) return;
        if (rpcError) {
          setError(rpcError.message);
        } else {
          setDisaggRows((data as DisaggRow[]) ?? []);
        }
      } else {
        // cross_tab: primary field is categorical. If the group-by field
        // is numeric, cross_tabulation still runs (it doesn't require
        // either side to be categorical -- it counts co-occurring exact
        // values), but a numeric field with many distinct values would
        // produce a wide, low-value table. Rather than silently produce
        // that, tell the user plainly instead of guessing at binning.
        if (groupByIsNumeric) {
          setError(
            `"${groupByLabel}" is a numeric field. Cross-tabulation compares two categorical fields -- pick a numeric field as the main field instead to see it broken down by "${groupByLabel}".`
          );
          setLoading(false);
          return;
        }
        const { data, error: rpcError } = await supabase.rpc("cross_tabulation", {
          p_row_field_id: fieldId,
          p_column_field_id: groupByFieldId!,
        });
        if (cancelled) return;
        if (rpcError) {
          setError(rpcError.message);
        } else {
          setCrossTabRows((data as CrossTabRow[]) ?? []);
        }
      }

      if (!cancelled) setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [supabase, fieldId, mode, groupByFieldId, isNumericField, groupByIsNumeric, groupByLabel]);

  if (loading) {
    return (
      <div className="text-sm" style={{ color: "#a39c8c" }}>
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="text-sm px-3 py-2.5 rounded-sm"
        style={{ background: "var(--status-off-track-bg)", color: "var(--status-off-track)" }}
      >
        {error}
      </div>
    );
  }

  if (mode === "plain" && isNumericField) {
    if (!numericSummary || numericSummary.response_count === 0) {
      return <EmptyResult fieldLabel={fieldLabel} />;
    }
    return <NumericStatCards summary={numericSummary} />;
  }

  if (mode === "plain") {
    if (frequencyRows.length === 0) return <EmptyResult fieldLabel={fieldLabel} />;
    return <FrequencyTable rows={frequencyRows} />;
  }

  if (mode === "disaggregated") {
    if (disaggRows.length === 0) return <EmptyResult fieldLabel={fieldLabel} />;
    return <DisaggregatedBars rows={disaggRows} groupByLabel={groupByLabel ?? "group"} />;
  }

  if (crossTabRows.length === 0) return <EmptyResult fieldLabel={fieldLabel} />;
  return <CrossTabGrid rows={crossTabRows} rowLabel={fieldLabel} columnLabel={groupByLabel ?? "group"} />;
}

function EmptyResult({ fieldLabel }: { fieldLabel: string }) {
  return (
    <div
      className="border rounded-sm p-6 text-center"
      style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
    >
      <p className="text-sm" style={{ color: "#a39c8c" }}>
        No answers recorded yet for &ldquo;{fieldLabel}&rdquo;.
      </p>
    </div>
  );
}

function NumericStatCards({ summary }: { summary: NumericSummary }) {
  const stats = [
    { label: "Responses", value: summary.response_count },
    { label: "Mean", value: summary.mean_value },
    { label: "Min", value: summary.min_value },
    { label: "Max", value: summary.max_value },
    { label: "Sum", value: summary.sum_value },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="border rounded-sm p-4"
          style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
        >
          <p
            className="text-xs uppercase tracking-wide mb-1"
            style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}
          >
            {s.label}
          </p>
          <p className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
            {s.value ?? "—"}
          </p>
        </div>
      ))}
    </div>
  );
}

function FrequencyTable({ rows }: { rows: FrequencyRow[] }) {
  const total = rows.reduce((sum, r) => sum + Number(r.response_count), 0);
  return (
    <div className="border rounded-sm overflow-hidden" style={{ borderColor: "var(--line)" }}>
      {rows.map((row, i) => {
        const pct = total > 0 ? Math.round((Number(row.response_count) / total) * 100) : 0;
        return (
          <div
            key={row.answer_value ?? i}
            className="px-4 py-3 flex items-center justify-between gap-4"
            style={{
              background: "var(--paper-raised)",
              borderTop: i > 0 ? "1px solid var(--line)" : undefined,
            }}
          >
            <span className="text-sm" style={{ color: "var(--ink)" }}>
              {row.answer_value ?? "—"}
            </span>
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-32 h-1.5 rounded-full overflow-hidden" style={{ background: "#efeae0" }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: "var(--status-on-track)" }}
                />
              </div>
              <span
                className="text-xs w-16 text-right"
                style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}
              >
                {row.response_count} ({pct}%)
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DisaggregatedBars({ rows, groupByLabel }: { rows: DisaggRow[]; groupByLabel: string }) {
  const maxMean = Math.max(...rows.map((r) => r.mean_value ?? 0), 0.01);
  return (
    <div>
      <p className="text-xs mb-3" style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}>
        Mean, by {groupByLabel}
      </p>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={row.group_value ?? i} className="flex items-center gap-3">
            <span className="text-sm w-24 shrink-0 truncate" style={{ color: "var(--ink)" }}>
              {row.group_value ?? "—"}
            </span>
            <div className="flex-1 h-6 rounded-sm overflow-hidden" style={{ background: "#efeae0" }}>
              <div
                className="h-full flex items-center px-2"
                style={{
                  width: `${((row.mean_value ?? 0) / maxMean) * 100}%`,
                  background: "var(--status-on-track)",
                  minWidth: "2px",
                }}
              />
            </div>
            <span
              className="text-xs w-24 shrink-0 text-right"
              style={{ fontFamily: "var(--font-mono)", color: "#6b6558" }}
            >
              {row.mean_value ?? "—"} (n={row.response_count})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CrossTabGrid({
  rows,
  rowLabel,
  columnLabel,
}: {
  rows: CrossTabRow[];
  rowLabel: string;
  columnLabel: string;
}) {
  const rowValues = [...new Set(rows.map((r) => r.row_value))];
  const colValues = [...new Set(rows.map((r) => r.column_value))];
  const cellLookup = new Map(rows.map((r) => [`${r.row_value}::${r.column_value}`, r.cell_count]));

  return (
    <div className="border rounded-sm overflow-x-auto" style={{ borderColor: "var(--line)" }}>
      <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "var(--paper-raised)" }}>
            <th
              className="text-left px-4 py-2.5 text-xs uppercase tracking-wide"
              style={{ fontFamily: "var(--font-mono)", color: "#8a8375", borderBottom: "1px solid var(--line)" }}
            >
              {rowLabel} \ {columnLabel}
            </th>
            {colValues.map((col) => (
              <th
                key={col}
                className="text-right px-4 py-2.5 text-xs uppercase tracking-wide"
                style={{ fontFamily: "var(--font-mono)", color: "#8a8375", borderBottom: "1px solid var(--line)" }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowValues.map((rowVal) => (
            <tr key={rowVal} style={{ background: "var(--paper-raised)" }}>
              <td className="px-4 py-2.5" style={{ color: "var(--ink)", borderBottom: "1px solid var(--line)" }}>
                {rowVal}
              </td>
              {colValues.map((colVal) => (
                <td
                  key={colVal}
                  className="text-right px-4 py-2.5"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--ink)", borderBottom: "1px solid var(--line)" }}
                >
                  {cellLookup.get(`${rowVal}::${colVal}`) ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
