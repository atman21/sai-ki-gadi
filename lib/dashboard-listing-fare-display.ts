/**
 * Client-safe listing fare display helpers.
 *
 * Pure formatting only — no server/RBAC imports. Safe for Client Components
 * (e.g. dashboard-tabs) so privileged modules never enter the browser bundle.
 */

/** Established hidden-fare display for admins without listings.fare_view. */
export const HIDDEN_LISTING_FARE_DISPLAY = "***";

export function formatListingFareForDisplay(
  price: unknown,
  canView: boolean,
): string {
  if (!canView) return HIDDEN_LISTING_FARE_DISPLAY;
  if (price == null || String(price).trim() === "") return "-";
  return `₹${price}`;
}

export function formatListingFareForExport(
  price: unknown,
  canView: boolean,
): string {
  if (!canView) return HIDDEN_LISTING_FARE_DISPLAY;
  if (price != null && String(price).trim() !== "") return String(price);
  return "-";
}
