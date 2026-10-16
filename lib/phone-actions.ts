/**
 * Phone action helpers for Admin Panel (Call / WhatsApp).
 * Display values stay unchanged; only action URLs use normalized forms.
 *
 * Country handling mirrors existing admin search (`+91` for 10-digit mobiles).
 */

export const ADMIN_DEFAULT_COUNTRY_CALLING_CODE = "91";

const PLACEHOLDER_RE = /^(—|-|–|—|n\/?a|null|undefined|none|no phone.*)?$/i;

export type NormalizedPhone = {
  /** Digits only, E.164 without leading +. Empty when unsafe/unknown. */
  e164Digits: string;
  /** tel: href including leading +, or null when not callable. */
  telHref: string | null;
  /** https://wa.me/... URL, or null when WhatsApp link is unsafe. */
  whatsAppUrl: string | null;
  /** True when we have a confident international number for actions. */
  actionable: boolean;
  /** Why actions are disabled, when not actionable. */
  reason?: string;
};

function stripToDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

function isIndianTenDigitMobile(digits: string): boolean {
  return digits.length === 10 && /^[6-9]\d{9}$/.test(digits);
}

/**
 * Normalize a displayed phone for tel: / wa.me actions.
 * Returns non-actionable result for empty, placeholder, or ambiguous values.
 */
export function normalizePhoneForActions(
  raw: string | null | undefined,
  options?: { defaultCountryCallingCode?: string },
): NormalizedPhone {
  const defaultCc =
    options?.defaultCountryCallingCode ?? ADMIN_DEFAULT_COUNTRY_CALLING_CODE;

  if (raw == null) {
    return {
      e164Digits: "",
      telHref: null,
      whatsAppUrl: null,
      actionable: false,
      reason: "empty",
    };
  }

  const trimmed = String(raw).trim();
  if (!trimmed || PLACEHOLDER_RE.test(trimmed)) {
    return {
      e164Digits: "",
      telHref: null,
      whatsAppUrl: null,
      actionable: false,
      reason: "empty",
    };
  }

  const hadPlus = trimmed.includes("+");
  let digits = stripToDigits(trimmed);

  // Trunk / international prefixes
  if (digits.startsWith("00") && digits.length > 2) {
    digits = digits.slice(2);
  }

  // App convention: bare 10-digit Indian mobiles → +91
  if (isIndianTenDigitMobile(digits) && defaultCc === "91") {
    digits = `91${digits}`;
  } else if (
    digits.length === 11 &&
    digits.startsWith("0") &&
    isIndianTenDigitMobile(digits.slice(1)) &&
    defaultCc === "91"
  ) {
    // 0XXXXXXXXXX local trunk
    digits = `91${digits.slice(1)}`;
  } else if (
    !hadPlus &&
    digits.length === 12 &&
    digits.startsWith("91") &&
    isIndianTenDigitMobile(digits.slice(2))
  ) {
    // already 91XXXXXXXXXX without +
  } else if (hadPlus && digits.length >= 10 && digits.length <= 15) {
    // Explicit international form — trust digits after +
  } else if (!hadPlus && digits.length >= 11 && digits.length <= 15) {
    // Likely already includes country code without +
  } else if (isIndianTenDigitMobile(digits)) {
    digits = `${defaultCc}${digits}`;
  } else {
    return {
      e164Digits: "",
      telHref: null,
      whatsAppUrl: null,
      actionable: false,
      reason: "ambiguous",
    };
  }

  // E.164 practical bounds (country code + subscriber)
  if (digits.length < 10 || digits.length > 15) {
    return {
      e164Digits: "",
      telHref: null,
      whatsAppUrl: null,
      actionable: false,
      reason: "ambiguous",
    };
  }

  return {
    e164Digits: digits,
    telHref: `tel:+${digits}`,
    whatsAppUrl: `https://wa.me/${digits}`,
    actionable: true,
  };
}

/** True when the string looks like a displayable phone we should try to act on. */
export function looksLikePhoneDisplay(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const trimmed = String(raw).trim();
  if (!trimmed || PLACEHOLDER_RE.test(trimmed)) return false;
  const digits = stripToDigits(trimmed);
  return digits.length >= 8;
}
