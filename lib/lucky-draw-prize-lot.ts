/**
 * Admin helpers for A19 Lucky Draw prize lots.
 * Dated prizes create a held lot (no spendable credit).
 * Undated prizes create a held lot then post it through the approved RPC.
 */

const TIMEZONE = "Asia/Kolkata";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

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
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
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

export type PrizeLotPlan =
  | { kind: "reject"; status: number; error: string }
  | { kind: "dated_hold"; expiresOn: string }
  | { kind: "undated_post"; expiresOn: null };

/**
 * Blank expiry → undated post path.
 * Valid future/today IST date → dated hold path (create lot only).
 */
export function planLuckyDrawPrizeLot(input: {
  transactionType: string;
  source: string;
  expiresOnRaw: unknown;
  todayKey: string;
}): PrizeLotPlan {
  const raw =
    input.expiresOnRaw == null ? "" : String(input.expiresOnRaw).trim();
  const prizeCredit =
    input.transactionType === "credit" && input.source === "lucky_draw_prize";

  if (!prizeCredit) {
    if (raw) {
      return {
        kind: "reject",
        status: 400,
        error: "An expiry date can be set only on a Lucky Draw prize credit.",
      };
    }
    return { kind: "undated_post", expiresOn: null };
  }

  if (!raw) {
    return { kind: "undated_post", expiresOn: null };
  }

  const expiresOn = parseCivilDate(raw);
  if (!expiresOn) {
    return {
      kind: "reject",
      status: 400,
      error: "Enter the expiry date as YYYY-MM-DD.",
    };
  }
  if (!parseCivilDate(input.todayKey) || expiresOn < input.todayKey) {
    return {
      kind: "reject",
      status: 400,
      error: "Expiry date must be today or later in India Standard Time.",
    };
  }

  return { kind: "dated_hold", expiresOn };
}

export type WinnerLinkOk = {
  ok: true;
  winnerId: string;
  recipientUserId: string;
};

export type WinnerLinkErr = {
  ok: false;
  status: number;
  error: string;
};

/**
 * Require an actual winner row. Linked winners must match the wallet member.
 * Text-only winners (user_id null) may credit the opened member wallet explicitly.
 */
export function validateWinnerRecipientLink(input: {
  winnerIdRaw: unknown;
  routeUserId: string;
  winnerRow: { id: string; user_id: string | null } | null;
}): WinnerLinkOk | WinnerLinkErr {
  const winnerId = String(input.winnerIdRaw ?? "").trim();
  if (!winnerId) {
    return {
      ok: false,
      status: 400,
      error: "Winner ID is required for Lucky Draw prize credits.",
    };
  }
  if (!isUuid(winnerId)) {
    return {
      ok: false,
      status: 400,
      error: "Winner ID must be a valid UUID.",
    };
  }
  if (!input.winnerRow || input.winnerRow.id !== winnerId) {
    return { ok: false, status: 400, error: "Winner not found." };
  }
  if (
    input.winnerRow.user_id != null &&
    input.winnerRow.user_id !== input.routeUserId
  ) {
    return {
      ok: false,
      status: 400,
      error:
        "Winner is linked to a different member. Open that member's wallet or select the matching winner.",
    };
  }
  return {
    ok: true,
    winnerId,
    recipientUserId: input.routeUserId,
  };
}

/**
 * Stable idempotency reference for lot creation retries.
 * Scoped by recipient, winner, amount, expiry, and client key.
 */
export function buildLuckyDrawLotIdempotencyKey(input: {
  userId: string;
  winnerId: string;
  amount: number;
  expiresOn: string | null;
  clientKey: string;
}): string {
  const opaque = input.clientKey.trim().slice(0, 80);
  const amount = Number(input.amount).toFixed(2);
  const exp = input.expiresOn ?? "none";
  const base = `ld-lot:${input.userId.trim()}:${input.winnerId.trim()}:${amount}:${exp}:${opaque}`;
  return base.length <= 200 ? base : base.slice(0, 200);
}

export const HELD_PRIZE_MESSAGE =
  "Lucky Draw prize lot created and held. It is not spendable wallet credit until posted or until policy allows posting. Expiry applies in India Standard Time.";
