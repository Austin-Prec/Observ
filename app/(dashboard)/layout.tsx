import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SessionRefresh } from "@/components/session-refresh";

/**
 * Auth guard for all (dashboard) routes, migrated from the pre-Next-16
 * middleware.ts (see lib/supabase/middleware.ts, now unused).
 *
 * Why this lives here instead of proxy.ts: as of Next.js 16, proxy.ts
 * always runs on the Node.js runtime with no config override, and
 * @opennextjs/cloudflare (our Cloudflare Workers deploy adapter) does not
 * yet support Node-runtime middleware -- see CLOUDFLARE_DEPLOY_BLOCKER.md.
 * Every (dashboard) route is already server-rendered per-request (see the
 * "f" markers in `next build` output), so a layout-level check here runs
 * on the same every-request cadence the old middleware did, just via
 * Server Components instead of the middleware hook.
 *
 * This covers every route under (dashboard) automatically -- Next runs
 * layouts before their child pages, so there's no per-page opt-in step
 * and no route can be added later without this check applying to it.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // IMPORTANT: do not run any code between createClient and
  // supabase.auth.getUser() -- same caution as the original middleware.
  // A simple mistake could make it very hard to debug issues with users
  // being randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <>
      <SessionRefresh />
      {children}
    </>
  );
}
