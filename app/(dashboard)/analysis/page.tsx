import { createClient } from "@/lib/supabase/server";
import { AnalysisClient } from "./analysis-client";

export default async function AnalysisPage() {
  const supabase = await createClient();

  const { data: forms } = await supabase
    .from("forms")
    .select("id, name, current_version")
    .eq("status", "published")
    .order("name");

  if (!forms || forms.length === 0) {
    return <AnalysisClient forms={[]} fieldsByForm={{}} />;
  }

  // For each published form, fetch its CURRENT version's field set via
  // form_version_fields -- not form_fields.form_version_id directly.
  // That direct-filter pattern was the exact bug found and fixed this
  // build (migrations 00006-00008): it only returns fields first
  // published under that specific version, silently dropping every
  // field carried forward from an earlier version. Every other screen
  // in this app was already corrected to join through
  // form_version_fields; this is analysis's turn to get it right from
  // the start rather than reintroduce the same mistake a fourth time.
  const fieldsByForm: Record<
    string,
    { id: string; label: string; field_type: string }[]
  > = {};

  for (const form of forms) {
    const { data: version } = await supabase
      .from("form_versions")
      .select("id")
      .eq("form_id", form.id)
      .eq("version", form.current_version)
      .maybeSingle();

    if (!version) continue;

    const { data: fields } = await supabase
      .from("form_version_fields")
      .select("sort_order, form_fields(id, label, field_type)")
      .eq("form_version_id", version.id)
      .order("sort_order");

    fieldsByForm[form.id] = (fields ?? [])
      .map((vf) => vf.form_fields)
      .filter((f): f is NonNullable<typeof f> => f !== null);
  }

  return <AnalysisClient forms={forms} fieldsByForm={fieldsByForm} />;
}
