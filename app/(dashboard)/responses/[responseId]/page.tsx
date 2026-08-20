import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResponseDetailClient } from "./response-detail-client";

export default async function ResponseDetailPage({
  params,
}: {
  params: Promise<{ responseId: string }>;
}) {
  const { responseId } = await params;
  const supabase = await createClient();

  const { data: response } = await supabase
    .from("form_responses")
    .select(
      "id, status, submitted_at, collected_by, verified_at, verification_note, form_version_id, form_versions(version, forms(id, name))"
    )
    .eq("id", responseId)
    .maybeSingle();

  if (!response) {
    notFound();
  }

  const { data: answers } = await supabase
    .from("response_answers")
    .select("id, field_id, answer_value, form_fields(label, field_type, sort_order)")
    .eq("response_id", responseId);

  const sortedAnswers = (answers ?? []).sort(
    (a, b) => (a.form_fields?.sort_order ?? 0) - (b.form_fields?.sort_order ?? 0)
  );

  const collectorPromise = response.collected_by
    ? supabase.from("profiles").select("full_name, email").eq("id", response.collected_by).maybeSingle()
    : Promise.resolve({ data: null });
  const { data: collector } = await collectorPromise;

  return (
    <ResponseDetailClient
      response={{
        id: response.id,
        status: response.status,
        submittedAt: response.submitted_at,
        verifiedAt: response.verified_at,
        verificationNote: response.verification_note,
        formName: response.form_versions?.forms?.name ?? "Unknown form",
        versionNumber: response.form_versions?.version ?? 0,
        collectorName: collector?.full_name || collector?.email || "Unknown collector",
      }}
      answers={sortedAnswers.map((a) => ({
        id: a.id,
        label: a.form_fields?.label ?? "Unknown field",
        fieldType: a.form_fields?.field_type ?? "text",
        value: a.answer_value,
      }))}
    />
  );
}
