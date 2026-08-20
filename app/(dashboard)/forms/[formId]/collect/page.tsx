import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CollectClient } from "./collect-client";

export default async function CollectPage({
  params,
}: {
  params: Promise<{ formId: string }>;
}) {
  const { formId } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase
    .from("forms")
    .select("id, name, description, status, current_version")
    .eq("id", formId)
    .maybeSingle();

  if (!form || form.status !== "published") {
    // A draft form has no stable, immutable field set -- there is
    // nothing safe to collect data against yet. This is a real
    // constraint from the schema (submit_form_response requires a
    // form_version_id, which only exists once publish_form has run),
    // not a UI-only restriction that could be bypassed.
    notFound();
  }

  const { data: version } = await supabase
    .from("form_versions")
    .select("id, version")
    .eq("form_id", formId)
    .eq("version", form.current_version)
    .maybeSingle();

  if (!version) {
    notFound();
  }

  // Query through form_version_fields, NOT a direct
  // form_fields.form_version_id filter. The latter was a real bug: it
  // only ever returned fields whose form_version_id happened to equal
  // exactly this version, which is true only for fields FIRST published
  // under this version -- fields carried forward from an earlier
  // version (the normal case whenever a form is republished with an
  // added/changed field) were silently excluded. Found and fixed in
  // migration 00006 after actually publishing a form a second time and
  // watching this exact query drop every pre-existing field. See that
  // migration's header for the full story.
  const { data: fields } = await supabase
    .from("form_version_fields")
    .select("sort_order, form_fields(id, field_type, label, help_text, is_required, options)")
    .eq("form_version_id", version.id)
    .order("sort_order");

  const orderedFields = (fields ?? [])
    .map((vf) => vf.form_fields)
    .filter((f): f is NonNullable<typeof f> => f !== null);

  return (
    <CollectClient
      formName={form.name}
      formVersionId={version.id}
      versionNumber={version.version}
      fields={orderedFields}
    />
  );
}
