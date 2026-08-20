"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Every mutation here calls a Postgres RPC (submit_form_response,
 * verify_response, flag_response -- migration 00005), never a direct
 * table insert/update. This isn't stylistic: form_responses and
 * response_answers grant no client-side UPDATE at all, and INSERT
 * validation (required fields, field-belongs-to-this-version) lives
 * entirely in submit_form_response(), verified against a live Postgres
 * instance this session. Duplicating that validation client-side would
 * only create a second place for it to drift out of sync with the
 * actual enforcement.
 */

export async function submitResponse(
  formVersionId: string,
  answers: { field_id: string; value: string | null }[],
  options?: {
    clientSubmissionId?: string;
    latitude?: number;
    longitude?: number;
  }
): Promise<ActionResult & { responseId?: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("submit_form_response", {
    p_form_version_id: formVersionId,
    p_answers: answers,
    p_client_submission_id: options?.clientSubmissionId ?? null,
    p_latitude: options?.latitude ?? null,
    p_longitude: options?.longitude ?? null,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/responses");
  revalidatePath("/dashboard");
  return { success: true, responseId: data };
}

export async function verifyResponse(
  responseId: string,
  note?: string
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("verify_response", {
    p_response_id: responseId,
    p_note: note ?? null,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/responses");
  return { success: true };
}

export async function flagResponse(
  responseId: string,
  note: string
): Promise<ActionResult> {
  if (!note.trim()) {
    // Mirrors the server-side check in flag_response() (migration
    // 00005: "A note explaining the flag is required"). This client-side
    // check is purely to avoid a round-trip for an error the server
    // would reject anyway -- the server check is still the actual
    // enforcement, since a client could skip this file entirely.
    return { success: false, error: "A note explaining the flag is required." };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("flag_response", {
    p_response_id: responseId,
    p_note: note.trim(),
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/responses");
  return { success: true };
}
