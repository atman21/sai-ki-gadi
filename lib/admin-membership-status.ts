/**
 * Membership state is independent from account ON/OFF (`users.status`).
 */
export type MembershipLifecycleStatus =
  | "Active"
  | "Expired"
  | "Not Subscribed";

export function getMembershipLifecycleStatus(
  user: {
    membership_type: string | null | undefined;
    membership_started_at: string | null | undefined;
    membership_expires_at: string | null | undefined;
  },
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
