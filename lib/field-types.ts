import type { FieldType } from "@/lib/supabase/database.types";

export const FIELD_TYPE_META: Record<
  FieldType,
  { label: string; description: string; needsOptions: boolean }
> = {
  text: { label: "Text", description: "Short or long free text", needsOptions: false },
  number: { label: "Number", description: "Numeric value with optional range", needsOptions: false },
  date: { label: "Date", description: "Calendar date picker", needsOptions: false },
  dropdown: { label: "Dropdown", description: "Single choice from a list", needsOptions: true },
  radio: { label: "Radio buttons", description: "Single choice, all options visible", needsOptions: true },
  checkbox: { label: "Checkboxes", description: "Multiple choice", needsOptions: true },
  likert_scale: { label: "Likert scale", description: "Agreement/rating scale", needsOptions: true },
  photo_upload: { label: "Photo", description: "Capture or upload a photo", needsOptions: false },
  file_upload: { label: "File", description: "Attach any file", needsOptions: false },
  signature: { label: "Signature", description: "Signature capture pad", needsOptions: false },
  gps_coordinates: { label: "GPS location", description: "Device location coordinates", needsOptions: false },
  barcode_qr: { label: "Barcode / QR", description: "Scan a barcode or QR code", needsOptions: false },
};

// Ordering for the "add field" palette -- most commonly used types first,
// specialized capture types (signature, GPS, barcode) last.
export const FIELD_TYPE_ORDER: FieldType[] = [
  "text",
  "number",
  "date",
  "dropdown",
  "radio",
  "checkbox",
  "likert_scale",
  "photo_upload",
  "file_upload",
  "signature",
  "gps_coordinates",
  "barcode_qr",
];
