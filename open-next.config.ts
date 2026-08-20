import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default config: builds this Next.js app into a Cloudflare Worker.
// R2/KV overrides for ISR caching aren't needed yet -- this app has no
// revalidate/ISR routes today (every dashboard route reads live via
// Supabase per-request, see lib/supabase/server.ts). Revisit if that
// changes.
export default defineCloudflareConfig();
