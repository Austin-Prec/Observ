import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every request and redirects
 * unauthenticated users away from protected routes. Called from
 * middleware.ts at the project root.
 *
 * This must run on every request that touches auth state, or sessions
 * expire silently and users get logged out at unpredictable times --
 * a known footgun in Next.js server-rendered apps with Supabase.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run any code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to
  // debug issues with users being randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/signup");
  const isPublicRoute = request.nextUrl.pathname.startsWith("/auth") ||
    isAuthRoute;

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    // Was "/projects" -- stale from before the dashboard/nav existed.
    // Fixed to match app/page.tsx's own logged-in redirect target,
    // found while tracing the root-page fix above; two different
    // "where does a logged-in user belong" answers coexisting in the
    // same app is exactly the kind of small inconsistency worth closing
    // once noticed rather than leaving for a later session to rediscover.
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // IMPORTANT: return supabaseResponse as-is. If you create a new response
  // object, make sure to copy the cookies from supabaseResponse, or the
  // refreshed session will not propagate to the browser, and the user's
  // session will be terminated early.
  return supabaseResponse;
}
