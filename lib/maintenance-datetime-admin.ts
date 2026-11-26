/**
 * Admin datetime-local ↔ UTC ISO helpers for maintenance schedule fields.
 * datetime-local values are always interpreted in the Admin browser's local TZ,
 * then stored as UTC ISO for timestamptz columns.
 */

export function toLocalDatetimeInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse datetime-local (no timezone) as local wall time → UTC ISO. */
export function fromLocalDatetimeInputValue(
  local: string | null | undefined,
): string | null {
  if (!local || !local.trim()) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    local.trim(),
  );
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const h = Number(m[4]);
    const mi = Number(m[5]);
    const s = Number(m[6] ?? "0");
    const date = new Date(y, mo - 1, d, h, mi, s, 0);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }
  const fallback = new Date(local);
  if (Number.isNaN(fallback.getTime())) return null;
  return fallback.toISOString();
}
