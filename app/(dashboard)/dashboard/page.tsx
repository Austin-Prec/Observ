import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id, organizations(name)")
    .eq("user_id", user?.id ?? "")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return <NoOrgState />;
  }

  const orgId = membership.organization_id;

  // Every count below is a real Supabase query against org-scoped data --
  // RLS still applies on top of these filters, so this is never wider
  // than what the current user's role can already see. Run in parallel
  // since none depend on each other.
  const [
    projectsResult,
    indicatorsResult,
    formsResult,
    logframeResult,
    recentAuditResult,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status", { count: "exact" })
      .eq("organization_id", orgId),
    supabase
      .from("indicators")
      .select("id, name, indicator_type, baseline_value, target_value, frequency", { count: "exact" })
      .eq("organization_id", orgId),
    supabase
      .from("forms")
      .select("id, name, status", { count: "exact" })
      .eq("organization_id", orgId),
    supabase
      .from("logframe_results")
      .select("id, level", { count: "exact" })
      .eq("organization_id", orgId),
    supabase
      .from("audit_logs")
      .select("id, action, target_table, created_at, actor_id, profiles(full_name, email)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const projects = projectsResult.data ?? [];
  const indicators = indicatorsResult.data ?? [];
  const forms = formsResult.data ?? [];
  const logframeResults = logframeResult.data ?? [];
  const recentAudit = recentAuditResult.data ?? [];

  const activeProjects = projects.filter((p) => p.status === "active").length;
  const publishedForms = forms.filter((f) => f.status === "published").length;
  const draftForms = forms.filter((f) => f.status === "draft").length;

  const indicatorsWithBaseline = indicators.filter((i) => i.baseline_value !== null).length;
  const indicatorsWithTarget = indicators.filter((i) => i.target_value !== null).length;
  const indicatorsFullySpecified = indicators.filter(
    (i) => i.baseline_value !== null && i.target_value !== null
  ).length;

  const resultsByLevel = {
    goal: logframeResults.filter((r) => r.level === "goal").length,
    purpose: logframeResults.filter((r) => r.level === "purpose").length,
    output: logframeResults.filter((r) => r.level === "output").length,
    activity: logframeResults.filter((r) => r.level === "activity").length,
  };

  return (
    <div>
      <header className="border-b px-8 py-5" style={{ borderColor: "var(--line)" }}>
        <div
          className="text-xs tracking-[0.2em] uppercase mb-0.5"
          style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}
        >
          {membership.organizations?.name ?? "Organization"}
        </div>
        <h1 className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
          Dashboard
        </h1>
      </header>

      <main className="px-8 py-8 max-w-6xl mx-auto space-y-8">
        {/* Top-line counts */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Active projects" value={activeProjects} total={projects.length} totalLabel="total" href="/projects" />
          <StatCard label="Indicators" value={indicators.length} href="/projects" />
          <StatCard
            label="Published forms"
            value={publishedForms}
            total={forms.length}
            totalLabel={`total${draftForms > 0 ? ` · ${draftForms} in draft` : ""}`}
            href="/forms"
          />
          <StatCard label="Logframe results" value={logframeResults.length} />
        </div>

        {/* Framework completeness -- this is real, computable signal:
            "is the M&E framework itself set up correctly," distinct from
            "is the program on track," which needs response data this
            build doesn't have yet. */}
        <section>
          <SectionHeading>Framework completeness</SectionHeading>
          <div
            className="border rounded-sm p-5"
            style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
          >
            {indicators.length === 0 ? (
              <EmptyRow text="No indicators defined yet. Build your indicator library to start tracking a framework." href="/projects" linkText="Go to projects" />
            ) : (
              <div className="space-y-3">
                <CompletenessBar
                  label="Indicators with a baseline value"
                  count={indicatorsWithBaseline}
                  total={indicators.length}
                />
                <CompletenessBar
                  label="Indicators with a target value"
                  count={indicatorsWithTarget}
                  total={indicators.length}
                />
                <CompletenessBar
                  label="Fully specified (baseline + target)"
                  count={indicatorsFullySpecified}
                  total={indicators.length}
                />
              </div>
            )}
          </div>
        </section>

        {/* Logframe hierarchy shape */}
        <section>
          <SectionHeading>Results hierarchy</SectionHeading>
          {logframeResults.length === 0 ? (
            <div
              className="border rounded-sm p-5"
              style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
            >
              <EmptyRow text="No Logframe built yet for any project." href="/projects" linkText="Go to projects" />
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              <LevelCard label="Goals" count={resultsByLevel.goal} />
              <LevelCard label="Purposes" count={resultsByLevel.purpose} />
              <LevelCard label="Outputs" count={resultsByLevel.output} />
              <LevelCard label="Activities" count={resultsByLevel.activity} />
            </div>
          )}
        </section>

        {/* Explicit, honest gap -- rather than fabricate a progress bar
            against target_value with no actual/current value anywhere
            in the schema, say plainly what's missing and why. */}
        <section>
          <SectionHeading>Progress against targets</SectionHeading>
          <div
            className="border rounded-sm p-5 flex items-start gap-3"
            style={{ borderColor: "var(--line)", background: "#faf9f6" }}
          >
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--status-attention)" }}>
              [ ]
            </span>
            <p className="text-sm" style={{ color: "#6b6558" }}>
              Not yet trackable. Indicators have baseline and target
              values, but no actual/current values are being collected
              yet — that requires the Data Collection module (form
              responses), which is a separate build from this pass. Once
              responses exist, this section will show real progress, not
              before.
            </p>
          </div>
        </section>

        {/* Recent activity, from the real (and now-verified-immutable)
            audit log. */}
        <section>
          <SectionHeading>Recent activity</SectionHeading>
          <div
            className="border rounded-sm divide-y"
            style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
          >
            {recentAudit.length === 0 ? (
              <div className="p-5">
                <p className="text-sm" style={{ color: "#a39c8c" }}>
                  No activity recorded yet.
                </p>
              </div>
            ) : (
              recentAudit.map((entry) => (
                <div key={entry.id} className="px-5 py-3 flex items-center justify-between gap-4" style={{ borderColor: "var(--line)" }}>
                  <div className="min-w-0">
                    <p className="text-sm" style={{ color: "var(--ink)" }}>
                      <span className="font-medium">
                        {entry.profiles?.full_name || entry.profiles?.email || "Unknown user"}
                      </span>{" "}
                      <span style={{ color: "#6b6558" }}>
                        {entry.action}
                        {entry.target_table ? ` · ${entry.target_table}` : ""}
                      </span>
                    </p>
                  </div>
                  <span
                    className="text-xs shrink-0"
                    style={{ fontFamily: "var(--font-mono)", color: "#a39c8c" }}
                  >
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  total,
  totalLabel,
  href,
}: {
  label: string;
  value: number;
  total?: number;
  totalLabel?: string;
  href?: string;
}) {
  const content = (
    <div
      className="border rounded-sm p-4"
      style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
    >
      <p
        className="text-xs uppercase tracking-wide mb-1"
        style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}
      >
        {label}
      </p>
      <p className="text-2xl" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
        {value}
        {total !== undefined && (
          <span className="text-sm ml-1" style={{ color: "#a39c8c" }}>
            / {total} {totalLabel}
          </span>
        )}
      </p>
    </div>
  );

  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {content}
    </Link>
  ) : (
    content
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-sm uppercase tracking-wide mb-3"
      style={{ fontFamily: "var(--font-mono)", color: "#6b6558" }}
    >
      {children}
    </h2>
  );
}

function CompletenessBar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm" style={{ color: "var(--ink)" }}>
          {label}
        </span>
        <span className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}>
          {count} / {total}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#efeae0" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: pct === 100 ? "var(--status-on-track)" : "var(--status-attention)",
          }}
        />
      </div>
    </div>
  );
}

function LevelCard({ label, count }: { label: string; count: number }) {
  return (
    <div
      className="border rounded-sm p-4 text-center"
      style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
    >
      <p className="text-2xl mb-1" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
        {count}
      </p>
      <p className="text-xs uppercase tracking-wide" style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}>
        {label}
      </p>
    </div>
  );
}

function EmptyRow({ text, href, linkText }: { text: string; href: string; linkText: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm" style={{ color: "#6b6558" }}>
        {text}
      </p>
      <Link href={href} className="text-sm font-medium shrink-0" style={{ color: "var(--ink)" }}>
        {linkText} →
      </Link>
    </div>
  );
}

function NoOrgState() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--paper)" }}>
      <div className="text-center max-w-sm">
        <p className="text-lg mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
          No organization yet
        </p>
        <p className="text-sm" style={{ color: "#6b6558" }}>
          You need to belong to an organization before a dashboard has
          anything to show.
        </p>
      </div>
    </div>
  );
}
