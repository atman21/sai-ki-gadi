/**
 * Optional expiry date for a new Lucky Draw prize credit.
 * A date is validated here and then held. It is not written to the ledger
 * until Track B reviews the database contract. Historical rows are untouched.
 */

const TIMEZONE = "Asia/Kolkata";

export type ExpiryDecision =
  | { action: "post"; expiresOn: null }
  | { action: "reject"; status: 400; error: string }
  | { action: "hold"; status: 409; error: string; expiresOn: string };

export function kolkataDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function parseCivilDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

const HOLD_ERROR =
  "This expiry date cannot be saved yet. The ledger contract is still under review. Clear the date to post the prize with no expiry.";

/**
 * Blank means no expiry, and the credit can post as it does today.
 * A usable date on a Lucky Draw prize credit is held and does not post.
 * Any other source or a debit cannot carry a date.
 */
export function evaluateLuckyDrawExpiry(input: {
  transactionType: string;
  source: string;
  expiresOnRaw: unknown;
  todayKey: string;
}): ExpiryDecision {
  const raw =
    input.expiresOnRaw == null ? "" : String(input.expiresOnRaw).trim();
  const prizeCredit =
    input.transactionType === "credit" && input.source === "lucky_draw_prize";

  if (!raw) return { action: "post", expiresOn: null };

  if (!prizeCredit) {
    return {
      action: "reject",
      status: 400,
      error: "An expiry date can be set only on a Lucky Draw prize credit.",
    };
  }

  const expiresOn = parseCivilDate(raw);
  if (!expiresOn) {
    return {
      action: "reject",
      status: 400,
      error: "Enter the expiry date as YYYY-MM-DD.",
    };
  }
  if (!parseCivilDate(input.todayKey) || expiresOn < input.todayKey) {
    return {
      action: "reject",
      status: 400,
      error: "Expiry date must be today or later in India Standard Time.",
    };
  }

  return {
    action: "hold",
    status: 409,
    error: HOLD_ERROR,
    expiresOn,
  };
}
