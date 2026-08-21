import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Browser-side Supabase client. Use this in Client Components ("use client").
 * For Server Components / Route Handlers, use lib/supabase/server.ts instead --
 * they need different cookie handling and must not share a client instance.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Next.js prerenders "use client" pages at build time to produce the
    // initial HTML, so this constructor runs even before any user visits
    // the page. If these vars aren't set as BUILD-time env vars (not just
    // runtime secrets) on the deploy platform, this throws here instead of
    // Supabase's generic "URL and API key are required" error.
    throw new Error(
      "Missing Supabase env vars: " +
        [!url && "NEXT_PUBLIC_SUPABASE_URL", !anonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY"]
          .filter(Boolean)
          .join(", ") +
        ". Set these as build-time environment variables in your deploy platform's project settings."
    );
  }

  return createBrowserClient<Database>(url, anonKey);
}
