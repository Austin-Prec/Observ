import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The root route was left as the unmodified create-next-app scaffold
// ("To get started, edit the page.tsx file...") for this entire build --
// every session built out sub-routes (/login, /dashboard, /forms,
// /responses, /analysis, /projects) but never touched the actual
// homepage a fresh visitor lands on first. Found when the live deployed
// site was fetched directly and turned out to be serving the Next.js
// starter template instead of Observ.
//
// There's no real marketing/landing content to write here -- this is an
// internal accountability tool for an organization's own staff, not a
// public product with a homepage. The correct behavior is an immediate
// redirect based on auth state: logged-in users go straight to their
// dashboard, logged-out users go to login. No one should ever actually
// see this page render.
export default async function RootPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}
