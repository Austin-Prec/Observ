"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.push("/projects");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-stretch">
      {/* Left: identity panel. Ink background carries the "structural,
          serious" register the product needs -- this is the first
          impression for program staff evaluating whether to trust their
          data to this tool. */}
      <div
        className="hidden lg:flex lg:w-2/5 flex-col justify-between p-12"
        style={{ background: "var(--ink)", color: "var(--paper)" }}
      >
        <div>
          <div
            className="text-xs tracking-[0.2em] uppercase mb-1"
            style={{ fontFamily: "var(--font-mono)", opacity: 0.6 }}
          >
            Monitoring &amp; Evaluation
          </div>
          <div className="text-2xl font-semibold" style={{ fontFamily: "var(--font-ui)" }}>
            Observ
          </div>
        </div>

        <blockquote
          className="text-xl leading-relaxed"
          style={{ fontFamily: "var(--font-display)", color: "var(--paper)" }}
        >
          &ldquo;Systems that work even when no one is watching &mdash;
          accountability built into the structure, not left to the
          person.&rdquo;
        </blockquote>

        <div
          className="text-xs"
          style={{ fontFamily: "var(--font-mono)", opacity: 0.5 }}
        >
          Every record attributed. Every change logged. Nothing edited
          after the fact.
        </div>
      </div>

      {/* Right: form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1
              className="text-2xl mb-1"
              style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}
            >
              Sign in
            </h1>
            <p className="text-sm" style={{ color: "#6b6558" }}>
              Enter your credentials to access your organization&rsquo;s
              workspace.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs uppercase tracking-wide mb-1.5"
                style={{ fontFamily: "var(--font-mono)", color: "#6b6558" }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-sm border outline-none focus:ring-2 transition-shadow"
                style={{
                  borderColor: "var(--line)",
                  background: "var(--paper-raised)",
                }}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs uppercase tracking-wide mb-1.5"
                style={{ fontFamily: "var(--font-mono)", color: "#6b6558" }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-sm border outline-none focus:ring-2 transition-shadow"
                style={{
                  borderColor: "var(--line)",
                  background: "var(--paper-raised)",
                }}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="text-sm px-3 py-2 rounded-sm"
                style={{
                  background: "var(--status-off-track-bg)",
                  color: "var(--status-off-track)",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-sm font-medium text-sm transition-opacity disabled:opacity-50"
              style={{ background: "var(--ink)", color: "var(--paper)" }}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
