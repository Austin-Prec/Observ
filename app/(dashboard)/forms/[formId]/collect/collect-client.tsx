"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { FieldType } from "@/lib/supabase/database.types";
import { submitResponse } from "@/lib/actions/responses";

type FieldRow = {
  id: string;
  field_type: FieldType;
  label: string;
  help_text: string | null;
  is_required: boolean;
  options: { value: string; label: string }[];
};

export function CollectClient({
  formName,
  formVersionId,
  versionNumber,
  fields,
}: {
  formName: string;
  formVersionId: string;
  versionNumber: number;
  fields: FieldRow[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Generated once per page load, not per submit -- this is the
  // idempotency key submit_form_response() uses to make a retried
  // network failure a no-op rather than a duplicate. Regenerating it on
  // every render would defeat the purpose; useMemo with an empty
  // dependency array pins it for the lifetime of this form instance.
  const clientSubmissionId = useMemo(() => crypto.randomUUID(), []);

  function setValue(fieldId: string, value: string) {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side required-field check for immediate feedback. This is
    // NOT the real guarantee -- submit_form_response() re-validates
    // required fields server-side regardless (verified this session:
    // Step 4 of the functional test confirms a missing-required-field
    // submission is rejected with zero partial writes even when this
    // client-side check is bypassed entirely). This check exists only
    // to avoid a round-trip for the common case.
    const missingRequired = fields.filter(
      (f) => f.is_required && !values[f.id]?.trim()
    );
    if (missingRequired.length > 0) {
      setError(
        `Please answer: ${missingRequired.map((f) => f.label).join(", ")}`
      );
      return;
    }

    setSubmitting(true);

    const answers = fields
      .filter((f) => values[f.id] !== undefined && values[f.id] !== "")
      .map((f) => ({ field_id: f.id, value: values[f.id] }));

    const result = await submitResponse(formVersionId, answers, {
      clientSubmissionId,
    });

    setSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--paper)" }}>
        <div className="text-center max-w-sm px-6">
          <p className="text-2xl mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
            Response recorded
          </p>
          <p className="text-sm mb-6" style={{ color: "#6b6558" }}>
            Your submission to &ldquo;{formName}&rdquo; has been saved.
          </p>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => {
                setValues({});
                setSubmitted(false);
              }}
              className="px-4 py-2 rounded-sm text-sm font-medium"
              style={{ background: "var(--ink)", color: "var(--paper)" }}
            >
              Submit another
            </button>
            <button
              onClick={() => router.push("/forms")}
              className="px-4 py-2 rounded-sm text-sm font-medium"
              style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--paper)" }}>
      <header className="border-b px-8 py-5" style={{ borderColor: "var(--line)" }}>
        <div
          className="text-xs tracking-[0.2em] uppercase mb-0.5"
          style={{ fontFamily: "var(--font-mono)", color: "#8a8375" }}
        >
          Data Collection · v{versionNumber}
        </div>
        <h1 className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
          {formName}
        </h1>
      </header>

      <main className="px-8 py-8 max-w-2xl mx-auto">
        <form onSubmit={handleSubmit} className="space-y-5">
          {fields.map((field) => (
            <FieldInput
              key={field.id}
              field={field}
              value={values[field.id] ?? ""}
              onChange={(v) => setValue(field.id, v)}
            />
          ))}

          {error && (
            <div
              role="alert"
              className="text-sm px-3 py-2 rounded-sm"
              style={{ background: "var(--status-off-track-bg)", color: "var(--status-off-track)" }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-sm font-medium text-sm disabled:opacity-50"
            style={{ background: "var(--ink)", color: "var(--paper)" }}
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </form>
      </main>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldRow;
  value: string;
  onChange: (v: string) => void;
}) {
  const labelEl = (
    <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--ink)" }}>
      {field.label}
      {field.is_required && <span style={{ color: "var(--status-off-track)" }}> *</span>}
    </label>
  );

  const helpEl = field.help_text && (
    <p className="text-xs mb-1.5" style={{ color: "#a39c8c" }}>
      {field.help_text}
    </p>
  );

  const inputStyle = {
    borderColor: "var(--line)",
    background: "var(--paper-raised)",
  };

  switch (field.field_type) {
    case "text":
      return (
        <div>
          {labelEl}
          {helpEl}
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
            className="w-full px-3 py-2.5 rounded-sm border outline-none focus:ring-2 resize-y"
            style={inputStyle}
          />
        </div>
      );

    case "number":
    case "likert_scale":
      return (
        <div>
          {labelEl}
          {helpEl}
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2.5 rounded-sm border outline-none focus:ring-2"
            style={inputStyle}
          />
        </div>
      );

    case "date":
      return (
        <div>
          {labelEl}
          {helpEl}
          <input
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2.5 rounded-sm border outline-none focus:ring-2"
            style={inputStyle}
          />
        </div>
      );

    case "dropdown":
      return (
        <div>
          {labelEl}
          {helpEl}
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2.5 rounded-sm border outline-none focus:ring-2"
            style={inputStyle}
          >
            <option value="">Select…</option>
            {field.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );

    case "radio":
      return (
        <div>
          {labelEl}
          {helpEl}
          <div className="space-y-1.5">
            {field.options.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
                <input
                  type="radio"
                  name={field.id}
                  value={opt.value}
                  checked={value === opt.value}
                  onChange={(e) => onChange(e.target.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      );

    case "checkbox": {
      // Multiple selections are stored as a comma-joined string in
      // answer_value (see migration 00005's comment on this column) --
      // the split/join here on the client mirrors that storage
      // convention rather than inventing its own.
      const selected = value ? value.split(",") : [];
      return (
        <div>
          {labelEl}
          {helpEl}
          <div className="space-y-1.5">
            {field.options.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, opt.value]
                      : selected.filter((v) => v !== opt.value);
                    onChange(next.join(","));
                  }}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      );
    }

    case "gps_coordinates":
      return (
        <div>
          {labelEl}
          {helpEl}
          <GpsCapture value={value} onChange={onChange} />
        </div>
      );

    case "photo_upload":
    case "file_upload":
    case "signature":
    case "barcode_qr":
      return (
        <div>
          {labelEl}
          {helpEl}
          <div
            className="border border-dashed rounded-sm p-4 text-center text-sm"
            style={{ borderColor: "var(--line)", color: "#a39c8c" }}
          >
            {FIELD_TYPE_NOT_YET_SUPPORTED[field.field_type]}
          </div>
        </div>
      );

    default:
      return null;
  }
}

// Photo/file/signature capture and barcode/QR scanning need real device
// APIs (camera access, file storage, a signature-pad library, a barcode
// decoder) that are genuine scope beyond what this pass can build and
// verify properly -- rendering a fake-looking file input that silently
// stores nothing would be worse than being direct that these aren't
// wired up yet. answer_value for these types is designed to hold a
// storage reference (migration 00005 comment); the missing piece is the
// actual upload/capture flow, not the schema.
const FIELD_TYPE_NOT_YET_SUPPORTED: Record<string, string> = {
  photo_upload: "Photo capture is not yet implemented in this build.",
  file_upload: "File upload is not yet implemented in this build.",
  signature: "Signature capture is not yet implemented in this build.",
  barcode_qr: "Barcode/QR scanning is not yet implemented in this build.",
};

function GpsCapture({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  function capture() {
    if (!navigator.geolocation) {
      setCaptureError("Geolocation is not available in this browser.");
      return;
    }
    setCapturing(true);
    setCaptureError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange(`${pos.coords.latitude},${pos.coords.longitude}`);
        setCapturing(false);
      },
      (err) => {
        setCaptureError(err.message);
        setCapturing(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={capture}
        disabled={capturing}
        className="px-3 py-2 rounded-sm border text-sm disabled:opacity-50"
        style={{ borderColor: "var(--line)", color: "var(--ink)" }}
      >
        {capturing ? "Capturing…" : value ? "Recapture location" : "Capture current location"}
      </button>
      {value && (
        <p className="text-xs mt-1.5" style={{ fontFamily: "var(--font-mono)", color: "#6b6558" }}>
          {value}
        </p>
      )}
      {captureError && (
        <p className="text-xs mt-1.5" style={{ color: "var(--status-off-track)" }}>
          {captureError}
        </p>
      )}
    </div>
  );
}
