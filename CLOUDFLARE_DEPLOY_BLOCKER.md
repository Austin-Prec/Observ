# Cloudflare Workers deployment — RESOLVED via layout-based auth

## Status: resolved (2026-08-20)

The Node.js-middleware blocker described below is resolved. Auth checks
were migrated out of `proxy.ts` (deleted) into route-group layouts, which
`@opennextjs/cloudflare` fully supports today. `npm run pages:build`
completes cleanly and produces `.open-next/worker.js`.

See `app/(dashboard)/layout.tsx`, `app/(auth)/layout.tsx`,
`app/api/auth/refresh/route.ts`, and `components/session-refresh.tsx` for
the migrated implementation and the reasoning behind each piece.

If `@opennextjs/cloudflare` ships Node-runtime middleware support later,
there's no obligation to migrate back — this implementation works
correctly on its own terms. Revisit only if a specific need arises (e.g.
wanting the auth check to run before static asset serving, which
middleware does and layouts don't).

---

## Original problem (kept for context)

`npm run pages:build` (via `@opennextjs/cloudflare`) fails on this app with:

```
ERROR Node.js middleware is not currently supported. Consider switching to Edge Middleware.
```

## Why

- Next.js 16 renamed `middleware.ts` → `proxy.ts`. As of Next 16, `proxy.ts`
  **always** runs on the Node.js runtime — there is no config flag to select
  Edge instead. `export const config = { runtime: "edge" }` is a build error
  in a `proxy.ts` file, full stop.
- Observ's `proxy.ts` (auth session refresh via `lib/supabase/middleware.ts`)
  is a real, unavoidable `proxy.ts` file — it needs `next/server`'s
  `NextRequest`/`NextResponse` and Supabase's `createServerClient`, none of
  which require Node.js APIs specifically, but the file is still bound to
  the Node runtime by the `proxy.ts` convention itself.
- `@opennextjs/cloudflare` (the adapter this repo uses to deploy Next.js as
  a Cloudflare Worker) has not yet implemented support for Node.js-runtime
  middleware. Cloudflare's own supported-features table confirms this as
  the one unsupported row: "Node.js in Middleware: not yet supported."
  Every other Next.js 16 feature this app uses (App Router, RSC, SSR,
  Server Actions, Route Handlers) is fully supported today.

## What's NOT the problem

- Not an env var issue (see `lib/supabase/client.ts` / `server.ts` — both
  guarded and confirmed working via local `next build`).
- Not a `wrangler.jsonc` / `open-next.config.ts` misconfiguration — the
  adapter gets far enough to inspect the middleware and correctly identify
  it as unsupported; the scaffolding is correct.
- Not fixable by renaming back to `middleware.ts` + `runtime: "edge"` —
  that pairs with `@cloudflare/next-on-pages` (Cloudflare's older, Edge-only,
  now-deprecated tool), which is a different toolchain than the
  Worker + `nodejs_compat` setup already in `wrangler.jsonc`. Mixing them
  doesn't produce a working combination as of this writing.

## Tracking

- Upstream issue: https://github.com/cloudflare/workers-sdk/issues/13755
  ("Version Trap: between Next.js 16's new Proxy architecture and
  OpenNext's current Cloudflare adapter")
- Also relevant: https://github.com/opennextjs/opennextjs-cloudflare/issues/962

## When this clears

Once `@opennextjs/cloudflare` ships Node-runtime middleware support, no
code changes should be needed here — `proxy.ts` and
`lib/supabase/middleware.ts` are already written the way Next 16 expects.
Re-run `npm run pages:build`; if it completes without the error above,
this file can be deleted.

## What actually happened

Auth was migrated out of `proxy.ts` into a shared pattern:
`(dashboard)/layout.tsx` and `(auth)/layout.tsx` each call
`createClient()` + `getUser()` to gate/redirect, covering every route in
their group automatically. A separate `/api/auth/refresh` Route Handler
(callable from Server Components, unlike middleware) handles persisting
refreshed session cookies back to the browser, since Server Components
can validate a session but cannot write cookies -- `SessionRefresh`
(a client component mounted in the dashboard layout) calls it once per
navigation into the dashboard.

