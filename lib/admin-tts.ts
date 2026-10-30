/**
 * Safe helpers for Admin TTS generation.
 * Keeps public /notifications/{file}.mp3 URLs for existing playback compatibility
 * while preventing path traversal, client-controlled names, overwrites, and
 * symlink-based directory escapes.
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TTS_MAX_TEXT_LENGTH = 1000;
export const TTS_ALLOWED_LANGUAGES = ["gu", "hi", "en"] as const;
export type TtsLanguage = (typeof TTS_ALLOWED_LANGUAGES)[number];

export const TTS_NOTIFICATIONS_DIRNAME = "notifications";

const SAFE_MP3_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-\d+\.mp3$/i;

export type TtsRequestValidation =
  | { ok: true; text: string; language: TtsLanguage }
  | { ok: false; error: string };

export function validateTtsRequestBody(body: unknown): TtsRequestValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid JSON body." };
  }
  const record = body as Record<string, unknown>;

  // Clients must not supply output paths or names.
  if (
    "filename" in record ||
    "filepath" in record ||
    "path" in record ||
    "url" in record
  ) {
    return { ok: false, error: "Output path fields are not allowed." };
  }

  if (typeof record.text !== "string") {
    return { ok: false, error: "Text is required." };
  }
  const text = record.text.trim();
  if (!text) {
    return { ok: false, error: "Text is required." };
  }
  if (text.length > TTS_MAX_TEXT_LENGTH) {
    return {
      ok: false,
      error: `Text must be at most ${TTS_MAX_TEXT_LENGTH} characters.`,
    };
  }

  const languageRaw =
    record.language === undefined || record.language === null
      ? "gu"
      : String(record.language).trim();
  if (!TTS_ALLOWED_LANGUAGES.includes(languageRaw as TtsLanguage)) {
    return { ok: false, error: "Language must be gu, hi, or en." };
  }

  return {
    ok: true,
    text,
    language: languageRaw as TtsLanguage,
  };
}

export function languageToBcp47(language: TtsLanguage): string {
  if (language === "hi") return "hi-IN";
  if (language === "en") return "en-IN";
  return "gu-IN";
}

export function buildSafeTtsFilename(now = Date.now()): string {
  return `${randomUUID()}-${now}.mp3`;
}

export function isSafeTtsFilename(filename: string): boolean {
  if (!filename || filename.includes("\0")) return false;
  if (
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("..")
  ) {
    return false;
  }
  return SAFE_MP3_NAME.test(filename);
}

function symlinkRejected(targetPath: string): string | null {
  try {
    if (!fs.existsSync(targetPath)) return null;
    if (fs.lstatSync(targetPath).isSymbolicLink()) {
      return "Invalid notifications directory.";
    }
    return null;
  } catch {
    return "Invalid notifications directory.";
  }
}

/**
 * Trusted absolute path for public/notifications.
 * Rejects when `public` or `public/notifications` is a symlink (escape risk).
 */
export function resolveTrustedNotificationsRoot(
  cwd = process.cwd(),
): { ok: true; absolutePath: string } | { ok: false; error: string } {
  const publicDir = path.resolve(cwd, "public");
  const notificationsRoot = path.resolve(publicDir, TTS_NOTIFICATIONS_DIRNAME);

  const publicSymlinkError = symlinkRejected(publicDir);
  if (publicSymlinkError) return { ok: false, error: publicSymlinkError };

  const notificationsSymlinkError = symlinkRejected(notificationsRoot);
  if (notificationsSymlinkError) {
    return { ok: false, error: notificationsSymlinkError };
  }

  if (fs.existsSync(notificationsRoot)) {
    try {
      const st = fs.lstatSync(notificationsRoot);
      if (!st.isDirectory()) {
        return { ok: false, error: "Invalid notifications directory." };
      }
      const realRoot = fs.realpathSync(notificationsRoot);
      if (realRoot !== notificationsRoot) {
        return { ok: false, error: "Invalid notifications directory." };
      }
    } catch {
      return { ok: false, error: "Invalid notifications directory." };
    }
  }

  return { ok: true, absolutePath: notificationsRoot };
}

/**
 * Resolve a filename under public/notifications. Rejects traversal and symlinked roots.
 */
export function resolveNotificationsMp3Path(
  filename: string,
  cwd = process.cwd(),
):
  | { ok: true; absolutePath: string; publicUrlPath: string }
  | { ok: false; error: string } {
  if (!isSafeTtsFilename(filename)) {
    return { ok: false, error: "Invalid output filename." };
  }

  const root = resolveTrustedNotificationsRoot(cwd);
  if (!root.ok) return root;

  const absolutePath = path.resolve(root.absolutePath, filename);
  if (absolutePath !== path.join(root.absolutePath, filename)) {
    return { ok: false, error: "Invalid output path." };
  }
  const relative = path.relative(root.absolutePath, absolutePath);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.includes("..") ||
    relative !== filename
  ) {
    return { ok: false, error: "Invalid output path." };
  }

  return {
    ok: true,
    absolutePath,
    publicUrlPath: `/${TTS_NOTIFICATIONS_DIRNAME}/${filename}`,
  };
}

export type ExclusiveWriteResult =
  | { ok: true; absolutePath: string; filename: string }
  | { ok: false; error: string; code?: string };

/**
 * Create a new MP3 exclusively (fails if the path already exists).
 * Never truncates or overwrites an existing file.
 * Optional cwd re-validates the target stays under trusted notifications root.
 */
export function writeMp3Exclusive(
  absolutePath: string,
  audio: Buffer,
  opts?: { cwd?: string },
): ExclusiveWriteResult {
  const filename = path.basename(absolutePath);
  if (!isSafeTtsFilename(filename)) {
    return { ok: false, error: "Invalid output filename." };
  }

  if (opts?.cwd !== undefined) {
    const resolved = resolveNotificationsMp3Path(filename, opts.cwd);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }
    if (path.resolve(absolutePath) !== resolved.absolutePath) {
      return { ok: false, error: "Invalid output path." };
    }
  } else {
    // Without cwd, still refuse writing through a symlinked parent directory.
    const parent = path.dirname(path.resolve(absolutePath));
    const parentSymlinkError = symlinkRejected(parent);
    if (parentSymlinkError) {
      return { ok: false, error: parentSymlinkError };
    }
  }

  try {
    fs.writeFileSync(absolutePath, audio, { flag: "wx" });
    return {
      ok: true,
      absolutePath,
      filename,
    };
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : undefined;
    if (code === "EEXIST") {
      return {
        ok: false,
        error: "Output file already exists.",
        code: "EEXIST",
      };
    }
    return { ok: false, error: "Unable to write audio file.", code };
  }
}

export type NewNotificationMp3Result =
  | {
      ok: true;
      absolutePath: string;
      filename: string;
      publicUrlPath: string;
    }
  | { ok: false; error: string; code?: string };

/**
 * Allocate a unique filename under notifications and write exclusively.
 * Retries on rare name collisions without touching existing files.
 */
export function writeNewNotificationMp3(
  audio: Buffer,
  opts?: { cwd?: string; maxAttempts?: number },
): NewNotificationMp3Result {
  const cwd = opts?.cwd ?? process.cwd();
  const maxAttempts = opts?.maxAttempts ?? 5;

  const root = resolveTrustedNotificationsRoot(cwd);
  if (!root.ok) {
    return { ok: false, error: root.error };
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const filename = buildSafeTtsFilename();
    const resolved = resolveNotificationsMp3Path(filename, cwd);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }
    const written = writeMp3Exclusive(resolved.absolutePath, audio, { cwd });
    if (written.ok) {
      return {
        ok: true,
        absolutePath: written.absolutePath,
        filename: written.filename,
        publicUrlPath: resolved.publicUrlPath,
      };
    }
    if (written.code !== "EEXIST") {
      return written;
    }
  }

  return { ok: false, error: "Unable to allocate a unique audio filename." };
}

/**
 * Inventory fingerprint for public notification MP3s: filename + content SHA-256.
 * Does not modify files.
 */
export function fingerprintNotificationsInventory(
  notificationsDir: string,
): { count: number; fingerprint: string; entries: { name: string; sha256: string }[] } {
  if (!fs.existsSync(notificationsDir)) {
    return { count: 0, fingerprint: "missing", entries: [] };
  }
  const names = fs
    .readdirSync(notificationsDir)
    .filter((f) => f.endsWith(".mp3"))
    .sort();
  const entries: { name: string; sha256: string }[] = [];
  const rollup = createHash("sha256");
  for (const name of names) {
    const absolute = path.join(notificationsDir, name);
    const st = fs.lstatSync(absolute);
    if (st.isSymbolicLink() || !st.isFile()) {
      continue;
    }
    const content = fs.readFileSync(absolute);
    const sha256 = createHash("sha256").update(content).digest("hex");
    entries.push({ name, sha256 });
    rollup.update(name);
    rollup.update("\0");
    rollup.update(sha256);
    rollup.update("\n");
  }
  return {
    count: entries.length,
    fingerprint: rollup.digest("hex"),
    entries,
  };
}
