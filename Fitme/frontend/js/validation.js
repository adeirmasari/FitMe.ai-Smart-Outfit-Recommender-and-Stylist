/** Client-side checks mirror the server rules so users get instant feedback.
 *  The server re-validates everything; these are a convenience, not a guard. */

export const MAX_BYTES = 8 * 1024 * 1024;
export const MIN_SIDE = 200;
export const MAX_SIDE = 8000;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

export const OCCASIONS = [
  { value: "casual", label: "Casual" },
  { value: "campus", label: "Campus" },
  { value: "work", label: "Work" },
  { value: "formal", label: "Formal event" },
  { value: "party", label: "Party" },
  { value: "other", label: "Other" },
];

export const TEXT_LIMITS = { occasion_detail: 80, preferred_style: 120, desired_impression: 120, additional_context: 300 };

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Synchronous checks on type and size. Returns an error message or null. */
export function checkFile(file) {
  if (!file) return "Choose a photo to analyze.";
  const name = (file.name || "").toLowerCase();
  const extOk = ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
  const typeOk = !file.type || ACCEPTED_TYPES.includes(file.type);
  if (!extOk || !typeOk) {
    if (name.endsWith(".heic") || name.endsWith(".heif") || file.type === "image/heic") {
      return "HEIC photos aren't supported yet. Export the photo as JPEG and try again.";
    }
    return "Use a JPEG, PNG or WebP image.";
  }
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_BYTES) return `That photo is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.`;
  return null;
}

/** Checks decoded pixel dimensions. Returns an error message or null. */
export function checkDimensions(width, height) {
  if (!width || !height) return "This file couldn't be read as an image.";
  if (Math.min(width, height) < MIN_SIDE) return `The photo is too small (${width}×${height}). Use at least ${MIN_SIDE}px per side.`;
  if (Math.max(width, height) > MAX_SIDE) return `The photo is too large (${width}×${height}). Keep it under ${MAX_SIDE}px.`;
  return null;
}


/** Validate the whole analysis form. Returns { valid, errors } keyed by field. */
export function validateBrief({ file, fileError, occasion, fields, source = "upload" }) {
  const errors = {};

  if (source === "upload") {
    const imageError = fileError || checkFile(file);
    if (imageError) errors.image = imageError;
  }

  if (!OCCASIONS.some((o) => o.value === occasion)) {
    errors.occasion = "Choose the occasion you're dressing for.";
  }

  for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
    const value = (fields?.[key] || "").trim();
    if (value.length > limit) {
      errors[key] = `Keep this under ${limit} characters.`;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Only exact #rrggbb strings from the API are ever used as CSS colours. */
export function safeHex(value) {
  return typeof value === "string" && HEX.test(value) ? value : null;
}
