"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FieldType } from "@/lib/supabase/database.types";
import { FIELD_TYPE_META, FIELD_TYPE_ORDER } from "@/lib/field-types";
import {
  addField,
  updateField,
  deleteField,
  reorderFields,
  publishForm,
} from "@/lib/actions/forms";

type FieldRow = {
  id: string;
  field_type: FieldType;
  label: string;
  help_text: string | null;
  sort_order: number;
  is_required: boolean;
  options: { value: string; label: string }[];
  form_version_id: string | null;
  depends_on_field_id: string | null;
  depends_on_value: string | null;
};

type FormRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  current_version: number;
  organization_id: string;
};

export function FormBuilderClient({
  form,
  initialFields,
}: {
  form: FormRow;
  initialFields: FieldRow[];
}) {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [showPalette, setShowPalette] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);

  const draftFieldCount = fields.filter((f) => f.form_version_id === null).length;
  const hasAnyDraftFields = draftFieldCount > 0;
  const isPublished = form.status === "published";

  function handleAddField(type: FieldType) {
    setShowPalette(false);
    setError(null);
    startTransition(async () => {
      const nextOrder = fields.length;
      const result = await addField(form.id, type, nextOrder);
      if (!result.success) {
        setError(result.error);
        return;
      }
      // Optimistically append; router.refresh() below re-syncs with the
      // server-assigned id/timestamps rather than trusting local state
      // to stay authoritative indefinitely.
      router.refresh();
    });
  }

  function handleLabelChange(fieldId: string, label: string) {
    setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, label } : f)));
  }

  function handleLabelBlur(fieldId: string, label: string) {
    startTransition(async () => {
      const result = await updateField(form.id, fieldId, { label });
      if (!result.success) {
        setError(result.error);
        router.refresh(); // revert to server truth if the edit was rejected (e.g. published mid-edit)
      }
    });
  }

  function handleRequiredToggle(fieldId: string, isRequired: boolean) {
    setFields((prev) =>
      prev.map((f) => (f.id === fieldId ? { ...f, is_required: isRequired } : f))
    );
    startTransition(async () => {
      const result = await updateField(form.id, fieldId, { is_required: isRequired });
      if (!result.success) {
        setError(result.error);
        router.refresh();
      }
    });
  }

  function handleDelete(fieldId: string) {
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
    startTransition(async () => {
      const result = await deleteField(form.id, fieldId);
      if (!result.success) {
        setError(result.error);
        router.refresh();
      }
    });
  }

  function handleMove(fieldId: string, direction: "up" | "down") {
    const index = fields.findIndex((f) => f.id === fieldId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= fields.length) return;

    const next = [...fields];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setFields(next);

    startTransition(async () => {
      const result = await reorderFields(
        form.id,
        next.map((f) => f.id)
      );
      if (!result.success) {
        setError(result.error);
        router.refresh();
      }
    });
  }

  function handlePublish() {
    setPublishConfirmOpen(false);
    startTransition(async () => {
      const result = await publishForm(form.id);
      if (!result.success) {
        setError(result.error);
        return;
      }
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
              Data Collection
            </div>
            <h1 className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
              {form.name}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-xs px-2 py-1 rounded-sm"
              style={{
                fontFamily: "var(--font-mono)",
                background: isPublished ? "var(--status-on-track-bg)" : "#f7ecdc",
                color: isPublished ? "var(--status-on-track)" : "var(--status-attention)",
              }}
            >
              {isPublished ? `Published · v${form.current_version}` : "Draft"}
            </span>
            {hasAnyDraftFields && (
              <button
                onClick={() => setPublishConfirmOpen(true)}
                disabled={isPending}
                className="px-4 py-2 rounded-sm text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--ink)", color: "var(--paper)" }}
              >
                {isPublished ? "Publish new version" : "Publish"}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="px-8 py-8 max-w-3xl mx-auto">
        {error && (
          <div
            role="alert"
            className="mb-4 text-sm px-3 py-2 rounded-sm flex items-start justify-between gap-3"
            style={{ background: "var(--status-off-track-bg)", color: "var(--status-off-track)" }}
          >
            <span>{error}</span>
            <button onClick={() => setError(null)} className="shrink-0 font-medium">
              Dismiss
            </button>
          </div>
        )}

        {isPublished && (
          <div
            className="mb-6 text-sm px-3 py-2.5 rounded-sm"
            style={{ background: "var(--paper-raised)", border: "1px solid var(--line)", color: "#6b6558" }}
          >
            This form has been published. Fields already published are
            permanently locked — this protects any responses already
            collected against them. New fields you add below will be part
            of the next version when you publish again.
          </div>
        )}

        {fields.length === 0 && (
          <div
            className="border rounded-sm p-8 text-center mb-4"
            style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
          >
            <p className="text-sm" style={{ color: "#6b6558" }}>
              No questions yet. Add your first field below.
            </p>
          </div>
        )}

        <div className="space-y-2 mb-4">
          {fields.map((field, index) => (
            <FieldCard
              key={field.id}
              field={field}
              isFirst={index === 0}
              isLast={index === fields.length - 1}
              onLabelChange={(label) => handleLabelChange(field.id, label)}
              onLabelBlur={(label) => handleLabelBlur(field.id, label)}
              onRequiredToggle={(v) => handleRequiredToggle(field.id, v)}
              onDelete={() => handleDelete(field.id)}
              onMoveUp={() => handleMove(field.id, "up")}
              onMoveDown={() => handleMove(field.id, "down")}
            />
          ))}
        </div>

        <div className="relative">
          <button
            onClick={() => setShowPalette((v) => !v)}
            className="w-full py-3 rounded-sm border border-dashed text-sm font-medium transition-colors"
            style={{ borderColor: "var(--line)", color: "#6b6558" }}
          >
            + Add question
          </button>

          {showPalette && (
            <div
              className="absolute z-10 mt-2 w-full border rounded-sm overflow-hidden shadow-lg"
              style={{ borderColor: "var(--line)", background: "var(--paper-raised)" }}
            >
              {FIELD_TYPE_ORDER.map((type) => (
                <button
                  key={type}
                  onClick={() => handleAddField(type)}
                  className="w-full text-left px-4 py-2.5 hover:bg-[var(--paper)] transition-colors flex items-baseline justify-between gap-3 border-b last:border-b-0"
                  style={{ borderColor: "var(--line)" }}
                >
                  <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                    {FIELD_TYPE_META[type].label}
                  </span>
                  <span className="text-xs" style={{ color: "#a39c8c" }}>
                    {FIELD_TYPE_META[type].description}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>

      {publishConfirmOpen && (
        <PublishConfirmDialog
          fieldCount={draftFieldCount}
          isFirstPublish={!isPublished}
          onConfirm={handlePublish}
          onCancel={() => setPublishConfirmOpen(false)}
        />
      )}
    </div>
  );
}

function FieldCard({
  field,
  isFirst,
  isLast,
  onLabelChange,
  onLabelBlur,
  onRequiredToggle,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  field: FieldRow;
  isFirst: boolean;
  isLast: boolean;
  onLabelChange: (label: string) => void;
  onLabelBlur: (label: string) => void;
  onRequiredToggle: (v: boolean) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const isLocked = field.form_version_id !== null;

  return (
    <div
      className="border rounded-sm p-4"
      style={{
        borderColor: "var(--line)",
        background: isLocked ? "#faf9f6" : "var(--paper-raised)",
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-0.5 pt-1.5 shrink-0">
          <button
            onClick={onMoveUp}
            disabled={isFirst || isLocked}
            className="text-xs leading-none disabled:opacity-20"
            style={{ color: "#8a8375" }}
            aria-label="Move up"
          >
            ▲
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast || isLocked}
            className="text-xs leading-none disabled:opacity-20"
            style={{ color: "#8a8375" }}
            aria-label="Move down"
          >
            ▼
          </button>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="text-xs px-1.5 py-0.5 rounded-sm shrink-0"
              style={{ fontFamily: "var(--font-mono)", background: "#efeae0", color: "#6b6558" }}
            >
              {FIELD_TYPE_META[field.field_type].label}
            </span>
            {isLocked && (
              <span
                className="text-xs flex items-center gap-1"
                style={{ fontFamily: "var(--font-mono)", color: "var(--status-attention)" }}
                title="This field is part of a published version and is permanently locked."
              >
                [locked]
              </span>
            )}
          </div>

          {isLocked ? (
            <p className="text-sm" style={{ color: "var(--ink)" }}>
              {field.label}
            </p>
          ) : (
            <input
              type="text"
              value={field.label}
              onChange={(e) => onLabelChange(e.target.value)}
              onBlur={(e) => onLabelBlur(e.target.value)}
              className="w-full text-sm bg-transparent outline-none border-b border-transparent focus:border-[var(--line)] pb-0.5"
              style={{ color: "var(--ink)" }}
            />
          )}

          {!isLocked && (
            <label className="flex items-center gap-1.5 mt-2 text-xs" style={{ color: "#6b6558" }}>
              <input
                type="checkbox"
                checked={field.is_required}
                onChange={(e) => onRequiredToggle(e.target.checked)}
              />
              Required
            </label>
          )}
          {isLocked && field.is_required && (
            <p className="text-xs mt-2" style={{ color: "#a39c8c" }}>
              Required
            </p>
          )}
        </div>

        {!isLocked && (
          <button
            onClick={onDelete}
            className="text-xs shrink-0"
            style={{ color: "var(--status-off-track)" }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function PublishConfirmDialog({
  fieldCount,
  isFirstPublish,
  onConfirm,
  onCancel,
}: {
  fieldCount: number;
  isFirstPublish: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center p-4"
      style={{ background: "rgba(15, 27, 45, 0.4)" }}
      onClick={onCancel}
    >
      <div
        className="max-w-sm w-full rounded-sm p-6"
        style={{ background: "var(--paper-raised)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
          {isFirstPublish ? "Publish this form?" : "Publish new version?"}
        </h2>
        <p className="text-sm mb-4" style={{ color: "#6b6558" }}>
          {fieldCount} question{fieldCount === 1 ? "" : "s"} will be
          locked permanently — you won&rsquo;t be able to edit or remove
          {fieldCount === 1 ? " it" : " them"} afterward, even by
          publishing again. This protects the integrity of any responses
          collected once data collection begins. You can still add new
          questions later as part of a future version.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-sm text-sm font-medium"
            style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-sm text-sm font-medium"
            style={{ background: "var(--ink)", color: "var(--paper)" }}
          >
            Publish
          </button>
        </div>
      </div>
    </div>
  );
}
