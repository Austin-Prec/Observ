import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: "#f7ecdc", fg: "var(--status-attention)", label: "Draft" },
  published: { bg: "var(--status-on-track-bg)", fg: "var(--status-on-track)", label: "Published" },
  archived: { bg: "#efeae0", fg: "#8a8375", label: "Archived" },
};

export default async function FormsPage() {
  const supabase = await createClient();

  const { data: forms } = await supabase
    .from("forms")
    .select("id, name, description, status, current_version, project_id, projects(name)")
    .order("created_at", { ascending: false });

  return (
    <div className="min-h-screen" style={{ background: "var(--paper)" }}>
      <header
        className="border-b px-8 py-5 flex items-center justify-between"
        style={{ borderColor: "var(--line)" }}
      >
        <div>
          <div
            className="text-xs tracking-[0.2em] uppercase mb-0.5"
            style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}
          >
            Data Collection
          </div>
          <h1 className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
            Forms
          </h1>
        </div>
        <Link
          href="/forms/new"
          className="px-4 py-2 rounded-sm text-sm font-medium"
          style={{ background: "var(--ink)", color: "var(--paper)" }}
        >
          New form
        </Link>
      </header>

      <main className="px-8 py-8 max-w-5xl mx-auto">
        {(forms?.length ?? 0) === 0 && (
          <div
            className="border rounded-sm p-8 text-center"
            style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
          >
            <p className="text-lg mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
              No forms yet
            </p>
            <p className="text-sm mb-4" style={{ color: "#6b6558" }}>
              Build a survey, KII guide, or checklist to start collecting
              data against your indicators.
            </p>
            <Link
              href="/forms/new"
              className="inline-block px-4 py-2 rounded-sm text-sm font-medium"
              style={{ background: "var(--ink)", color: "var(--paper)" }}
            >
              New form
            </Link>
          </div>
        )}

        {(forms?.length ?? 0) > 0 && (
          <div className="space-y-3">
            {forms!.map((form) => {
              const style = STATUS_STYLE[form.status] ?? STATUS_STYLE.draft;
              return (
                <div
                  key={form.id}
                  className="border rounded-sm p-5"
                  style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <Link href={`/forms/${form.id}`} className="min-w-0 hover:opacity-80 transition-opacity">
                      <h2 className="text-base font-medium mb-1" style={{ color: "var(--ink)" }}>
                        {form.name}
                      </h2>
                      {form.description && (
                        <p className="text-sm mb-1" style={{ color: "#6b6558" }}>
                          {form.description}
                        </p>
                      )}
                      {form.projects?.name && (
                        <p
                          className="text-xs"
                          style={{ fontFamily: "var(--font-mono)", color: "#a39c8c" }}
                        >
                          {form.projects.name}
                        </p>
                      )}
                    </Link>
                    <div className="flex flex-col items-end gap-1 whitespace-nowrap">
                      <span
                        className="text-xs px-2 py-1 rounded-sm"
                        style={{ fontFamily: "var(--font-mono)", background: style.bg, color: style.fg }}
                      >
                        {style.label}
                      </span>
                      {form.current_version > 0 && (
                        <span
                          className="text-xs"
                          style={{ fontFamily: "var(--font-mono)", color: "#a39c8c" }}
                        >
                          v{form.current_version}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-3 pt-3 border-t" style={{ borderColor: "var(--line)" }}>
                    <Link href={`/forms/${form.id}`} className="text-xs font-medium" style={{ color: "var(--ink)" }}>
                      Edit form
                    </Link>
                    {form.status === "published" && (
                      <Link
                        href={`/forms/${form.id}/collect`}
                        className="text-xs font-medium"
                        style={{ color: "var(--status-on-track)" }}
                      >
                        Collect data →
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
