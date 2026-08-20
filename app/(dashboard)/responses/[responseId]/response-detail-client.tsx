"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyResponse, flagResponse } from "@/lib/actions/responses";

type ResponseInfo = {
  id: string;
  status: string;
  submittedAt: string;
  verifiedAt: string | null;
  verificationNote: string | null;
  formName: string;
  versionNumber: number;
  collectorName: string;
};

type AnswerInfo = {
  id: string;
  label: string;
  fieldType: string;
  value: string | null;
};

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  submitted: { bg: "#f7ecdc", fg: "var(--status-attention)", label: "Submitted" },
  verified: { bg: "var(--status-on-track-bg)", fg: "var(--status-on-track)", label: "Verified" },
  flagged: { bg: "var(--status-off-track-bg)", fg: "var(--status-off-track)", label: "Flagged" },
  rejected: { bg: "#efeae0", fg: "#8a8375", label: "Rejected" },
};

export function ResponseDetailClient({
  response,
  answers,
}: {
  response: ResponseInfo;
  answers: AnswerInfo[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flagDialogOpen, setFlagDialogOpen] = useState(false);
  const [flagNote, setFlagNote] = useState("");

  const style = STATUS_STYLE[response.status] ?? STATUS_STYLE.submitted;

  function handleVerify() {
    setError(null);
    startTransition(async () => {
      const result = await verifyResponse(response.id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleFlag() {
    if (!flagNote.trim()) {
      setError("A note explaining the flag is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await flagResponse(response.id, flagNote);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setFlagDialogOpen(false);
      setFlagNote("");
      router.refresh();
    });
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--paper)" }}>
      <header className="border-b px-8 py-5" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div
              className="text-xs tracking-[0.2em] uppercase mb-0.5"
              style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}
            >
              Response · {response.formName} v{response.versionNumber}
            </div>
            <h1 className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
              {response.collectorName}
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "#8a8375" }}>
              Submitted {new Date(response.submittedAt).toLocaleString()}
            </p>
          </div>
          <span
            className="text-xs px-2 py-1 rounded-sm shrink-0"
            style={{ fontFamily: "var(--font-mono)", background: style.bg, color: style.fg }}
          >
            {style.label}
          </span>
        </div>
      </header>

      <main className="px-8 py-8 max-w-2xl mx-auto">
        {error && (
          <div
            role="alert"
            className="mb-4 text-sm px-3 py-2 rounded-sm"
            style={{ background: "var(--status-off-track-bg)", color: "var(--status-off-track)" }}
          >
            {error}
          </div>
        )}

        {(response.status === "verified" || response.status === "flagged") && response.verificationNote && (
          <div
            className="mb-6 text-sm px-3 py-2.5 rounded-sm"
            style={{
              background: response.status === "flagged" ? "var(--status-off-track-bg)" : "var(--status-on-track-bg)",
              color: response.status === "flagged" ? "var(--status-off-track)" : "var(--status-on-track)",
            }}
          >
            <span className="font-medium">
              {response.status === "flagged" ? "Flagged: " : "Verified: "}
            </span>
            {response.verificationNote}
            {response.verifiedAt && (
              <span className="opacity-70"> · {new Date(response.verifiedAt).toLocaleString()}</span>
            )}
          </div>
        )}

        <div className="space-y-4 mb-6">
          {answers.map((a) => (
            <div
              key={a.id}
              className="border rounded-sm p-4"
              style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
            >
              <p
                className="text-xs uppercase tracking-wide mb-1"
                style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}
              >
                {a.label}
              </p>
              <p className="text-sm" style={{ color: "var(--ink)" }}>
                {a.value || <span style={{ color: "#a39c8c" }}>No answer</span>}
              </p>
            </div>
          ))}
        </div>

        {response.status === "submitted" && (
          <div className="flex gap-2">
            <button
              onClick={handleVerify}
              disabled={isPending}
              className="px-4 py-2 rounded-sm text-sm font-medium disabled:opacity-50"
              style={{ background: "var(--ink)", color: "var(--paper)" }}
            >
              Verify
            </button>
            <button
              onClick={() => setFlagDialogOpen(true)}
              disabled={isPending}
              className="px-4 py-2 rounded-sm text-sm font-medium disabled:opacity-50"
              style={{ border: "1px solid var(--status-off-track)", color: "var(--status-off-track)" }}
            >
              Flag
            </button>
          </div>
        )}
      </main>

      {flagDialogOpen && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center p-4"
          style={{ background: "rgba(15, 27, 45, 0.4)" }}
          onClick={() => setFlagDialogOpen(false)}
        >
          <div
            className="max-w-sm w-full rounded-sm p-6"
            style={{ background: "var(--paper-raised)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
              Flag this response
            </h2>
            <p className="text-sm mb-3" style={{ color: "#6b6558" }}>
              Explain what&rsquo;s wrong with this submission. This note
              is required and will be visible in the audit trail.
            </p>
            <textarea
              value={flagNote}
              onChange={(e) => setFlagNote(e.target.value)}
              rows={3}
              autoFocus
              className="w-full px-3 py-2.5 rounded-sm border outline-none focus:ring-2 mb-4"
              style={{ borderColor: "var(--line)", background: "var(--paper)" }}
              placeholder="e.g. Number of children under 5 seems inconsistent with household size reported elsewhere."
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setFlagDialogOpen(false)}
                className="px-4 py-2 rounded-sm text-sm font-medium"
                style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleFlag}
                disabled={isPending}
                className="px-4 py-2 rounded-sm text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--status-off-track)", color: "var(--paper)" }}
              >
                Flag response
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
