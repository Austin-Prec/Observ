import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  submitted: { bg: "#f7ecdc", fg: "var(--status-attention)", label: "Submitted" },
  verified: { bg: "var(--status-on-track-bg)", fg: "var(--status-on-track)", label: "Verified" },
  flagged: { bg: "var(--status-off-track-bg)", fg: "var(--status-off-track)", label: "Flagged" },
  rejected: { bg: "#efeae0", fg: "#8a8375", label: "Rejected" },
};

export default async function ResponsesPage() {
  const supabase = await createClient();

  const { data: responses } = await supabase
    .from("form_responses")
    .select(
      "id, status, submitted_at, collected_by, verification_note, form_versions(version, forms(name))"
    )
    .order("submitted_at", { ascending: false })
    .limit(50);

  // form_responses has TWO foreign keys into profiles (collected_by and
  // verified_by) -- an embedded `profiles(...)` select on the query
  // above would be genuinely ambiguous to PostgREST, and while the
  // !form_responses_collected_by_fkey disambiguation hint syntax exists
  // and the constraint name was confirmed correct against the real
  // schema, this sandbox has no way to run it against actual PostgREST
  // to confirm it resolves correctly rather than silently joining the
  // wrong column -- a failure mode worse than an error, since it would
  // look like it worked. Fetching collector profiles in an unambiguous
  // second query instead removes that doubt entirely.
  const collectorIds = [...new Set((responses ?? []).map((r) => r.collected_by).filter((id): id is string => id !== null))];
  const { data: collectors } = collectorIds.length > 0
    ? await supabase.from("profiles").select("id, full_name, email").in("id", collectorIds)
    : { data: [] };
  const collectorById = new Map((collectors ?? []).map((c) => [c.id, c]));

  return (
    <div>
      <header className="border-b px-8 py-5" style={{ borderColor: "var(--line)" }}>
        <div
          className="text-xs tracking-[0.2em] uppercase mb-0.5"
          style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}
        >
          Data Collection
        </div>
        <h1 className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
          Responses
        </h1>
      </header>

      <main className="px-8 py-8 max-w-4xl mx-auto">
        {(responses?.length ?? 0) === 0 && (
          <div
            className="border rounded-sm p-8 text-center"
            style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
          >
            <p className="text-sm" style={{ color: "#6b6558" }}>
              No responses collected yet. Publish a form and start
              collecting data from the form&rsquo;s collection link.
            </p>
          </div>
        )}

        {(responses?.length ?? 0) > 0 && (
          <div className="border rounded-sm divide-y" style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}>
            {responses!.map((r) => {
              const style = STATUS_STYLE[r.status] ?? STATUS_STYLE.submitted;
              return (
                <Link
                  key={r.id}
                  href={`/responses/${r.id}`}
                  className="block px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-[var(--paper)] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                      {r.form_versions?.forms?.name ?? "Unknown form"}
                      <span className="ml-1.5 font-normal" style={{ fontFamily: "var(--font-mono)", color: "#a39c8c" }}>
                        v{r.form_versions?.version}
                      </span>
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#8a8375" }}>
                      {collectorById.get(r.collected_by ?? "")?.full_name ||
                        collectorById.get(r.collected_by ?? "")?.email ||
                        "Unknown collector"}{" "}
                      · {new Date(r.submitted_at).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className="text-xs px-2 py-1 rounded-sm shrink-0"
                    style={{ fontFamily: "var(--font-mono)", background: style.bg, color: style.fg }}
                  >
                    {style.label}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
