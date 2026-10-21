/** Shared by the Admin Panel save API and the Priority Timeline preview. */

export const PRIORITY_DURATION_ERROR =
  "Diamond and Gold durations must be whole minutes between 1 and 1440.";

export function isWholePriorityMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 1440;
}

/**
 * Gold starts when the Diamond window ends.
 * Everyone starts when the Gold window ends.
 * Matches compute_booking_priority_stage: elapsed < window.
 */
export function bookingPriorityTimeline(
  diamondMinutes: number,
  goldMinutes: number,
) {
  return {
    diamondMinutes,
    goldMinutes,
    goldStartsAtMinute: diamondMinutes,
    everyoneStartsAtMinute: diamondMinutes + goldMinutes,
  };
}

export function buildPrioritySettingsUpdate(input: {
  diamondMinutes: number;
  goldMinutes: number;
  existingLegacySilverMinutes: number;
}):
  | {
      ok: true;
      row: {
        all_platinum_minutes: number;
        all_gold_minutes: number;
        matching_platinum_minutes: number;
      };
    }
  | { ok: false; error: string } {
  if (
    !isWholePriorityMinutes(input.diamondMinutes) ||
    !isWholePriorityMinutes(input.goldMinutes)
  ) {
    return { ok: false, error: PRIORITY_DURATION_ERROR };
  }

  return {
    ok: true,
    row: {
      all_platinum_minutes: input.diamondMinutes,
      all_gold_minutes: input.goldMinutes,
      matching_platinum_minutes: input.existingLegacySilverMinutes,
    },
  };
}
