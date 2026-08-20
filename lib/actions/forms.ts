"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { FieldType } from "@/lib/supabase/database.types";

export type ActionResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Every function in this file is a thin wrapper around a real Supabase
 * call -- there is no client-side-only mutation path for form data. This
 * matters specifically for form_fields: the DB-level immutability
 * trigger (trg_form_fields_immutable_once_published, migration 00004)
 * and the RLS deny-update/delete policies are the actual source of
 * truth for what's editable, verified against a live Postgres instance
 * in the prior session. If a UI action here silently no-ops (0 rows
 * affected) because a field was already published, that is the correct,
 * enforced behavior, not a bug to route around client-side.
 */

export async function createForm(
  organizationId: string,
  projectId: string | null,
  name: string
): Promise<ActionResult & { formId?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Not authenticated." };

  const { data, error } = await supabase
    .from("forms")
    .insert({
      organization_id: organizationId,
      project_id: projectId,
      name,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath("/forms");
  return { success: true, formId: data.id };
}

export async function addField(
  formId: string,
  fieldType: FieldType,
  sortOrder: number
): Promise<ActionResult & { fieldId?: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("form_fields")
    .insert({
      form_id: formId,
      field_type: fieldType,
      label: defaultLabelFor(fieldType),
      sort_order: sortOrder,
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath(`/forms/${formId}`);
  return { success: true, fieldId: data.id };
}

export async function updateField(
  formId: string,
  fieldId: string,
  patch: {
    label?: string;
    help_text?: string | null;
    is_required?: boolean;
    options?: { value: string; label: string }[];
    validation?: Record<string, unknown>;
  }
): Promise<ActionResult> {
  const supabase = await createClient();

  // Intentionally NOT checking form_version_id client-side before this
  // call. If the field was published between page load and this submit
  // (e.g. another tab published it), the update below will correctly
  // affect 0 rows -- RLS + the immutability trigger enforce this, not
  // this function. We surface that as a real error rather than a false
  // "saved" message.
  const { data, error } = await supabase
    .from("form_fields")
    .update(patch)
    .eq("id", fieldId)
    .select("id");

  if (error) return { success: false, error: error.message };

  if (!data || data.length === 0) {
    return {
      success: false,
      error:
        "This field could not be updated. It may have already been published, which makes it permanently read-only.",
    };
  }

  revalidatePath(`/forms/${formId}`);
  return { success: true };
}

export async function deleteField(
  formId: string,
  fieldId: string
): Promise<ActionResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("form_fields")
    .delete()
    .eq("id", fieldId)
    .select("id");

  if (error) return { success: false, error: error.message };

  if (!data || data.length === 0) {
    return {
      success: false,
      error: "This field could not be deleted. It may have already been published.",
    };
  }

  revalidatePath(`/forms/${formId}`);
  return { success: true };
}

export async function reorderFields(
  formId: string,
  orderedFieldIds: string[]
): Promise<ActionResult> {
  const supabase = await createClient();

  // Applied as individual updates rather than a single bulk statement:
  // postgrest-js has no multi-row "update different values per row" in
  // one call, and each row independently passes through the same
  // draft-only RLS check. If a field was published mid-drag, its update
  // here simply affects 0 rows and its position silently doesn't move --
  // acceptable for a draft-reordering UI, since the field list is
  // re-fetched (revalidatePath) immediately after regardless.
  const results = await Promise.all(
    orderedFieldIds.map((id, index) =>
      supabase.from("form_fields").update({ sort_order: index }).eq("id", id)
    )
  );

  const firstError = results.find((r) => r.error);
  if (firstError?.error) return { success: false, error: firstError.error.message };

  revalidatePath(`/forms/${formId}`);
  return { success: true };
}

export async function publishForm(formId: string): Promise<ActionResult> {
  const supabase = await createClient();

  // This calls the publish_form() RPC from migration 00004 directly --
  // the same function whose permission check was found to have a real
  // privilege-escalation bug (NULL-vs-false in a plpgsql `if not`) and
  // fixed against a live Postgres instance in the prior session. The
  // fix lives in the database function itself; this action does not
  // duplicate that permission logic client-side.
  const { error } = await supabase.rpc("publish_form", { p_form_id: formId });

  if (error) return { success: false, error: error.message };

  revalidatePath(`/forms/${formId}`);
  revalidatePath("/forms");
  return { success: true };
}

function defaultLabelFor(fieldType: FieldType): string {
  const labels: Record<FieldType, string> = {
    text: "Untitled text question",
    number: "Untitled number question",
    date: "Untitled date question",
    dropdown: "Untitled dropdown question",
    radio: "Untitled radio question",
    checkbox: "Untitled checkbox question",
    likert_scale: "Untitled Likert scale question",
    photo_upload: "Untitled photo upload",
    file_upload: "Untitled file upload",
    signature: "Untitled signature",
    gps_coordinates: "Untitled GPS location",
    barcode_qr: "Untitled barcode/QR scan",
  };
  return labels[fieldType];
}
