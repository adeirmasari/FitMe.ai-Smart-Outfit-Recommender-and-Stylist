/** Client-side checks mirror the server rules so users get instant feedback.
 *  The server re-validates everything; these are a convenience, not a guard. */

export const MAX_BYTES = 8 * 1024 * 1024;
export const MIN_SIDE = 200;
export const MAX_SIDE = 8000;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

export const OCCASIONS = [
  { value: "casual", label: "Kasual" },
  { value: "campus", label: "Kampus" },
  { value: "work", label: "Kerja" },
  { value: "formal", label: "Acara formal" },
  { value: "party", label: "Pesta" },
  { value: "other", label: "Lainnya" },
];

export const TEXT_LIMITS = { occasion_detail: 80, preferred_style: 120, desired_impression: 120, additional_context: 300 };

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Synchronous checks on type and size. Returns an error message or null. */
export function checkFile(file) {
  if (!file) return "Pilih foto yang ingin dianalisis.";
  const name = (file.name || "").toLowerCase();
  const extOk = ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
  const typeOk = !file.type || ACCEPTED_TYPES.includes(file.type);
  if (!extOk || !typeOk) {
    if (name.endsWith(".heic") || name.endsWith(".heif") || file.type === "image/heic") {
      return "Foto HEIC belum didukung. Simpan foto sebagai JPEG lalu coba lagi.";
    }
    return "Gunakan gambar berformat JPEG, PNG, atau WebP.";
  }
  if (file.size === 0) return "File tersebut kosong.";
  if (file.size > MAX_BYTES) return `Ukuran foto ${formatBytes(file.size)}. Batas ukuran ${formatBytes(MAX_BYTES)}.`;
  return null;
}

/** Checks decoded pixel dimensions. Returns an error message or null. */
export function checkDimensions(width, height) {
  if (!width || !height) return "File ini tidak dapat dibaca sebagai gambar.";
  if (Math.min(width, height) < MIN_SIDE) return `Resolusi foto terlalu kecil (${width}×${height}). Gunakan minimal ${MIN_SIDE}px pada setiap sisi.`;
  if (Math.max(width, height) > MAX_SIDE) return `Resolusi foto terlalu besar (${width}×${height}). Gunakan maksimal ${MAX_SIDE}px pada setiap sisi.`;
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
    errors.occasion = "Pilih acara yang akan dihadiri.";
  }

  for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
    // Detail acara hanya dipakai (dan divalidasi) saat memilih "Other".
    if (key === "occasion_detail" && occasion !== "other") continue;
    const value = (fields?.[key] || "").trim();
    if (value.length > limit) {
      errors[key] = `Batasi isian ini hingga ${limit} karakter.`;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Only exact #rrggbb strings from the API are ever used as CSS colours. */
export function safeHex(value) {
  return typeof value === "string" && HEX.test(value) ? value : null;
}
