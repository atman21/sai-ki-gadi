/**
 * Optional member link for Lucky Draw winners.
 *
 * Product model (intentional): Admin winner UI is text-only (date + winner_text).
 * `user_id` stays null unless an API client explicitly supplies a real member id.
 * Never invent or auto-select a member from names/text.
 */

import { isUuid } from "@/lib/lucky-draw-prize-lot";

export type WinnerUserLinkResult =
  | { ok: true; userId: string | null; provided: boolean }
  | { ok: false; error: string };

/**
 * Parse optional `user_id` from a winners create/update body.
 * - Key absent → provided=false (create defaults to null; update preserves existing).
 * - null / "" → explicit text-only (userId null, provided=true).
 * - non-empty → must be a UUID (caller must verify the user exists).
 */
export function resolveOptionalWinnerUserId(
  body: Record<string, unknown>,
): WinnerUserLinkResult {
  if (!Object.prototype.hasOwnProperty.call(body, "user_id")) {
    return { ok: true, userId: null, provided: false };
  }

  const raw = body.user_id;
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, userId: null, provided: true };
  }

  if (typeof raw !== "string") {
    return { ok: false, error: "user_id must be a UUID string or null." };
  }

  const userId = raw.trim();
  if (!isUuid(userId)) {
    return { ok: false, error: "user_id must be a valid member UUID." };
  }

  return { ok: true, userId, provided: true };
}
