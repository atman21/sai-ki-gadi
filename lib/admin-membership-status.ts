/**
 * Membership state is independent from account ON/OFF (`users.status`).
 */
export type MembershipLifecycleStatus =
  | "Active"
  | "Expired"
  | "Not Subscribed";

type MembershipFields = {
  membership_type: string | null | undefined;
  membership_started_at: string | null | undefined;
  membership_expires_at: string | null | undefined;
};

export function getMembershipLifecycleStatus(
  user: MembershipFields,
  now = Date.now(),
): MembershipLifecycleStatus {
  if (!user.membership_type || user.membership_type === "regular") {
    return "Not Subscribed";
  }
  const expiry = user.membership_expires_at
    ? Date.parse(user.membership_expires_at)
    : Number.NaN;
  const start = user.membership_started_at
    ? Date.parse(user.membership_started_at)
    : Number.NaN;
  if (!Number.isFinite(expiry)) return "Expired";
  if (Number.isFinite(start) && start > now) return "Expired";
  return expiry > now ? "Active" : "Expired";
}

/**
 * Manual Gold → Regular is blocked while Gold is still valid, or when expiry
 * data is missing/invalid (do not blindly downgrade). Returns null when allowed.
 */
export function getManualGoldDowngradeBlockReason(
  user: MembershipFields,
  now = Date.now(),
): string | null {
  if (user.membership_type !== "gold") return null;

  const expiry = user.membership_expires_at
    ? Date.parse(user.membership_expires_at)
    : Number.NaN;

  if (!Number.isFinite(expiry)) {
    return "Cannot downgrade Gold membership with missing or invalid expiry. Fix expiry data; automatic expiry only runs when membership_expires_at has passed.";
  }

  if (expiry > now) {
    return "Cannot downgrade active Gold membership before expiry. It reverts to Regular automatically after the expiry date/time.";
  }

  return null;
}
