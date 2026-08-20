import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Refreshes the Supabase session and persists any rotated tokens to
 * cookies, migrated from the pre-Next-16 middleware.ts (see
 * lib/supabase/middleware.ts, now unused).
 *
 * Why this exists: Server Components (including layouts) can call
 * supabase.auth.getUser(), which does revalidate an expiring token
 * against Supabase's Auth server -- but Server Components cannot write
 * cookies (see the try/catch in lib/supabase/server.ts's setAll, which
 * expects to fail when called from one). Without something that CAN
 * write cookies also calling getUser(), a refreshed token is validated
 * server-side but never makes it back to the browser, so the next
 * request repeats the refresh, races other requests doing the same
 * (see supabase/supabase#18981 -- concurrent refreshes can invalidate
 * each other's tokens), and the user is eventually logged out.
 *
 * Route Handlers, unlike Server Components, CAN write cookies -- so
 * this is the migrated home for exactly what middleware used to do:
 * call getUser(), let the Supabase client's cookie handlers persist
 * whatever it refreshes. IMPORTANT: do not add logic between
 * createClient() and getUser() -- same caution as the original
 * middleware and as app/(dashboard)/layout.tsx.
 *
 * Called from the client on mount by SessionRefresh (see
 * components/session-refresh.tsx), once per navigation into a
 * (dashboard) route -- not on every request the way middleware ran,
 * since there's no server-side hook left that fires on every request
 * without Node-runtime middleware support in the Cloudflare adapter.
 */
export async function POST() {
  const supabase = await createClient();

  await supabase.auth.getUser();

  return NextResponse.json({ refreshed: true });
}
