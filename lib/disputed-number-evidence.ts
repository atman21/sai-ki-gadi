/** Private disputed-number evidence helpers (Admin service-role only). */

export const DISPUTED_EVIDENCE_BUCKET = "disputed-number-evidence";
export const DISPUTED_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const DISPUTED_REMARKS_MAX_LENGTH = 2000;
export const DISPUTED_SIGNED_URL_TTL_SEC = 120;

export const DISPUTED_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type DetectedImageKind = "jpeg" | "png" | "webp" | null;

export function detectImageKindFromBytes(bytes: Uint8Array): DetectedImageKind {
  if (bytes.length < 12) return null;
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  // PNG
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  // WEBP: RIFF....WEBP
  const riff =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46;
  const webp =
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  if (riff && webp) return "webp";
  return null;
}

export function mimeForImageKind(kind: DetectedImageKind): string | null {
  if (kind === "jpeg") return "image/jpeg";
  if (kind === "png") return "image/png";
  if (kind === "webp") return "image/webp";
  return null;
}

export function extForImageKind(kind: DetectedImageKind): string | null {
  if (kind === "jpeg") return "jpg";
  if (kind === "png") return "png";
  if (kind === "webp") return "webp";
  return null;
}

export function validateRemarks(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Remarks are required." };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Remarks are required." };
  }
  if (trimmed.length > DISPUTED_REMARKS_MAX_LENGTH) {
    return {
      ok: false,
      error: `Remarks must be at most ${DISPUTED_REMARKS_MAX_LENGTH} characters.`,
    };
  }
  return { ok: true, value: trimmed };
}
