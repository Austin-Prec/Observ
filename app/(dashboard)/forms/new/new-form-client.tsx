"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createForm } from "@/lib/actions/forms";

export function NewFormClient({
  organizationId,
  projects,
}: {
  organizationId: string;
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give the form a name.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const result = await createForm(organizationId, projectId || null, name.trim());

    setSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    router.push(`/forms/${result.formId}`);
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--paper)" }}>
      <header className="border-b px-8 py-5" style={{ borderColor: "var(--line)" }}>
        <div
          className="text-xs tracking-[0.2em] uppercase mb-0.5"
          style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}
        >
          Data Collection
        </div>
        <h1 className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
          New form
        </h1>
      </header>

      <main className="px-8 py-8 max-w-lg mx-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="name"
              className="block text-xs uppercase tracking-wide mb-1.5"
              style={{ fontFamily: "var(--font-mono)", color: "#6b6558" }}
            >
              Form name
            </label>
            <input
              id="name"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Household Nutrition Survey"
              className="w-full px-3 py-2.5 rounded-sm border outline-none focus:ring-2"
              style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
            />
          </div>

          <div>
            <label
              htmlFor="project"
              className="block text-xs uppercase tracking-wide mb-1.5"
              style={{ fontFamily: "var(--font-mono)", color: "#6b6558" }}
            >
              Project (optional)
            </label>
            <select
              id="project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-sm border outline-none focus:ring-2"
              style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
            >
              <option value="">No project — reusable template</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div
              role="alert"
              className="text-sm px-3 py-2 rounded-sm"
              style={{ background: "var(--status-off-track-bg)", color: "var(--status-off-track)" }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-sm font-medium text-sm disabled:opacity-50"
            style={{ background: "var(--ink)", color: "var(--paper)" }}
          >
            {submitting ? "Creating…" : "Create form"}
          </button>
        </form>
      </main>
    </div>
  );
}
