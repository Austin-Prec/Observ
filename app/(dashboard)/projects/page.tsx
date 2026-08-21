import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const STATUS_LABEL: Record<string, string> = {
  planning: "Planning",
  active: "Active",
  closed: "Closed",
  archived: "Archived",
};

export default async function ProjectsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Membership lookup drives both the "no org yet" empty state and the
  // project query below -- a user with zero active memberships should
  // never reach a project query at all (RLS would return zero rows
  // anyway, but distinguishing "no org" from "org with no projects" in
  // the UI needs this lookup explicitly).
  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", user?.id ?? "")
    .eq("status", "active");

  const hasOrg = (memberships?.length ?? 0) > 0;

  // Query unconditionally rather than branching on hasOrg: RLS already
  // returns zero rows for a user with no active membership, so the
  // conditional added no safety, only a TypeScript inference problem
  // (the ternary previously collapsed `projects` to `never`).
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, description, status, start_date, end_date")
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
            Monitoring &amp; Evaluation
          </div>
          <h1
            className="text-xl"
            style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
          >
            Projects
          </h1>
        </div>
        {hasOrg && (
          <Link
            href="/projects/new"
            className="px-4 py-2 rounded-sm text-sm font-medium"
            style={{ background: "var(--ink)", color: "var(--paper)" }}
          >
            New project
          </Link>
        )}
      </header>

      <main className="px-8 py-8 max-w-5xl mx-auto">
        {!hasOrg && (
          <div
            className="border rounded-sm p-8 text-center"
            style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
          >
            <p
              className="text-lg mb-2"
              style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
            >
              No organization yet
            </p>
            <p className="text-sm mb-4" style={{ color: "#6b6558" }}>
              You need to belong to an organization before you can create
              or view projects. Ask an administrator to invite you, or set
              up a new organization to get started.
            </p>
          </div>
        )}

        {hasOrg && (projects?.length ?? 0) === 0 && (
          <div
            className="border rounded-sm p-8 text-center"
            style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
          >
            <p
              className="text-lg mb-2"
              style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
            >
              No projects yet
            </p>
            <p className="text-sm mb-4" style={{ color: "#6b6558" }}>
              Create your first project to start building its Logframe
              and defining indicators.
            </p>
            <Link
              href="/projects/new"
              className="inline-block px-4 py-2 rounded-sm text-sm font-medium"
              style={{ background: "var(--ink)", color: "var(--paper)" }}
            >
              New project
            </Link>
          </div>
        )}

        {hasOrg && (projects?.length ?? 0) > 0 && (
          <div className="space-y-3">
            {projects!.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block border rounded-sm p-5 transition-colors hover:border-[var(--ink)]"
                style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2
                      className="text-base font-medium mb-1"
                      style={{ color: "var(--ink)" }}
                    >
                      {project.name}
                    </h2>
                    {project.description && (
                      <p className="text-sm" style={{ color: "#6b6558" }}>
                        {project.description}
                      </p>
                    )}
                  </div>
                  <span
                    className="text-xs px-2 py-1 rounded-sm whitespace-nowrap"
                    style={{
                      fontFamily: "var(--font-mono)",
                      background: "var(--status-on-track-bg)",
                      color: "var(--status-on-track)",
                    }}
                  >
                    {STATUS_LABEL[project.status] ?? project.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
