# Cloudflare Workers deployment — blocked on Node.js middleware support

## Status: blocked upstream, not a bug in this repo

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

## Fallback if this needs to ship before the upstream fix lands

Move the auth check out of `proxy.ts` into a shared server-only helper
(e.g. `lib/auth/require-user.ts`) called from the top of each
`(dashboard)/**/layout.tsx` or `page.tsx`. This trades one central
enforcement point for auth checks spread across each protected route, but
runs entirely in Server Components/Route Handlers, which OpenNext supports
today. Not done yet because it's a real amount of surface area to touch
and get right (every dashboard route needs it, and it's easy to miss one)
for a gap that appears actively being closed upstream — revisit if this
turns out to be blocking a deploy on a deadline.
