/**
 * Canonical Indian mobile normalization for Disputed Numbers matching.
 *
 * MUST stay identical to:
 *   sai-ki-gadi-V2/lib/disallowed-reference-mobile.ts
 *   → normalizeIndianMobileForReference
 *
 * Do not invent a second algorithm. Tests assert source parity.
 */

/**
 * Normalize an Indian mobile for reference validation / disputed matching.
 *
 * Steps (safe — not raw trailing substring matching):
 * 1. Remove spaces and hyphens
 * 2. Keep digits only
 * 3. Strip a single leading `91` country code when length is 12
 * 4. Strip a single leading `0` when length is 11
 * 5. Accept only a resulting 10-digit number
 */
export function normalizeIndianMobileForReference(
  value: unknown,
): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const withoutSeparators = String(value).replace(/[\s-]/g, "");
  let digits = withoutSeparators.replace(/\D/g, "");

  if (digits.startsWith("91") && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0") && digits.length === 11) {
    digits = digits.slice(1);
  }

  if (digits.length !== 10 || !/^\d{10}$/.test(digits)) return null;
  return digits;
}

/** Disputed numbers require a valid Indian mobile starting 6–9. */
export function isValidDisputedMobile(normalized: string | null): boolean {
  return Boolean(normalized && /^[6-9]\d{9}$/.test(normalized));
}
