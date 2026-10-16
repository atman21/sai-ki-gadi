/**
 * Regression checks for phone Call / WhatsApp URL normalization.
 * Run: node scripts/verify-phone-actions.mjs
 */

import assert from "node:assert/strict";

const ADMIN_DEFAULT_COUNTRY_CALLING_CODE = "91";
const PLACEHOLDER_RE = /^(—|-|–|—|n\/?a|null|undefined|none|no phone.*)?$/i;

function stripToDigits(raw) {
  return raw.replace(/\D/g, "");
}

function isIndianTenDigitMobile(digits) {
  return digits.length === 10 && /^[6-9]\d{9}$/.test(digits);
}

function normalizePhoneForActions(raw, options = {}) {
  const defaultCc =
    options.defaultCountryCallingCode ?? ADMIN_DEFAULT_COUNTRY_CALLING_CODE;

  if (raw == null) {
    return { e164Digits: "", telHref: null, whatsAppUrl: null, actionable: false };
  }

  const trimmed = String(raw).trim();
  if (!trimmed || PLACEHOLDER_RE.test(trimmed)) {
    return { e164Digits: "", telHref: null, whatsAppUrl: null, actionable: false };
  }

  const hadPlus = trimmed.includes("+");
  let digits = stripToDigits(trimmed);

  if (digits.startsWith("00") && digits.length > 2) {
    digits = digits.slice(2);
  }

  if (isIndianTenDigitMobile(digits) && defaultCc === "91") {
    digits = `91${digits}`;
  } else if (
    digits.length === 11 &&
    digits.startsWith("0") &&
    isIndianTenDigitMobile(digits.slice(1)) &&
    defaultCc === "91"
  ) {
    digits = `91${digits.slice(1)}`;
  } else if (
    !hadPlus &&
    digits.length === 12 &&
    digits.startsWith("91") &&
    isIndianTenDigitMobile(digits.slice(2))
  ) {
    // ok
  } else if (hadPlus && digits.length >= 10 && digits.length <= 15) {
    // ok
  } else if (!hadPlus && digits.length >= 11 && digits.length <= 15) {
    // ok
  } else if (isIndianTenDigitMobile(digits)) {
    digits = `${defaultCc}${digits}`;
  } else {
    return { e164Digits: "", telHref: null, whatsAppUrl: null, actionable: false };
  }

  if (digits.length < 10 || digits.length > 15) {
    return { e164Digits: "", telHref: null, whatsAppUrl: null, actionable: false };
  }

  return {
    e164Digits: digits,
    telHref: `tel:+${digits}`,
    whatsAppUrl: `https://wa.me/${digits}`,
    actionable: true,
  };
}

// International with +
{
  const r = normalizePhoneForActions("+91 98765-43210");
  assert.equal(r.actionable, true);
  assert.equal(r.e164Digits, "919876543210");
  assert.equal(r.telHref, "tel:+919876543210");
  assert.equal(r.whatsAppUrl, "https://wa.me/919876543210");
}

// Already has country code digits
{
  const r = normalizePhoneForActions("919876543210");
  assert.equal(r.actionable, true);
  assert.equal(r.e164Digits, "919876543210");
}

// Bare 10-digit Indian (app convention)
{
  const r = normalizePhoneForActions("9876543210");
  assert.equal(r.actionable, true);
  assert.equal(r.e164Digits, "919876543210");
  assert.equal(r.whatsAppUrl, "https://wa.me/919876543210");
}

// Empty / placeholder
for (const v of [null, undefined, "", "—", "-", "  "]) {
  const r = normalizePhoneForActions(v);
  assert.equal(r.actionable, false);
  assert.equal(r.whatsAppUrl, null);
  assert.equal(r.telHref, null);
}

// Ambiguous short number — no incorrect WhatsApp URL
{
  const r = normalizePhoneForActions("12345");
  assert.equal(r.actionable, false);
  assert.equal(r.whatsAppUrl, null);
}

// Do not double-prefix when +91 already present
{
  const r = normalizePhoneForActions("+919876543210");
  assert.equal(r.e164Digits, "919876543210");
}

console.log("verify-phone-actions: all checks passed");
