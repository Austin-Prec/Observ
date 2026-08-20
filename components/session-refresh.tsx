"use client";

import { useEffect } from "react";

/**
 * Fires the /api/auth/refresh route handler once on mount, so an
 * expiring Supabase session gets refreshed and the rotated cookie
 * persisted to the browser -- see app/api/auth/refresh/route.ts for
 * the full rationale on why this exists post-middleware.
 *
 * Mounted in app/(dashboard)/layout.tsx, so it runs once per full
 * navigation into any dashboard route (not on every client-side
 * route change within the dashboard, since the layout persists across
 * those -- matching middleware's old "once per navigation" cadence
 * closely enough for a background refresh, not a hard security gate;
 * the actual gate is the server-side getUser() check in the layout).
 *
 * Fire-and-forget: a failed refresh here doesn't block rendering.
 * getUser() in the layout is still the authority on whether the user
 * is currently authenticated -- this only affects whether their
 * session stays fresh for next time.
 */
export function SessionRefresh() {
  useEffect(() => {
    fetch("/api/auth/refresh", { method: "POST" }).catch(() => {
      // Best-effort. If this fails, the next call to getUser() in a
      // layout or page will still correctly reflect current auth
      // state -- it just won't have proactively refreshed a
      // near-expiry token, so the user may need to refresh sooner.
    });
  }, []);

  return null;
}
