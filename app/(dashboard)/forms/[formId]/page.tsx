import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FormBuilderClient } from "./form-builder-client";

export default async function FormBuilderPage({
  params,
}: {
  params: Promise<{ formId: string }>;
}) {
  const { formId } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase
    .from("forms")
    .select("id, name, description, status, current_version, organization_id")
    .eq("id", formId)
    .maybeSingle();

  if (!form) {
    // Covers both "genuinely doesn't exist" and "exists but RLS hid it
    // because it belongs to another org" -- from the client's point of
    // view these are indistinguishable, and they should be: a 404 here
    // leaks no information about whether the ID belongs to someone else.
    notFound();
  }

  const { data: fields } = await supabase
    .from("form_fields")
    .select(
      "id, field_type, label, help_text, sort_order, is_required, options, form_version_id, depends_on_field_id, depends_on_value"
    )
    .eq("form_id", formId)
    .order("sort_order");

  return <FormBuilderClient form={form} initialFields={fields ?? []} />;
}
