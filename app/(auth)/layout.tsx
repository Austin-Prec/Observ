import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Redirects already-authenticated users away from auth routes (/login,
 * and /signup once it exists), migrated from lib/supabase/middleware.ts.
 * See app/(dashboard)/layout.tsx for the full rationale on why this
 * moved out of proxy.ts.
 *
 * Scoped to the (auth) route group, so it only runs for routes that
 * actually need it -- unlike the old middleware's isAuthRoute check,
 * which ran on every request project-wide before branching.
 */
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/projects");
  }

  return <>{children}</>;
}
