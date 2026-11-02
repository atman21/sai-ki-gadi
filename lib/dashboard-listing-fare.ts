import type { AdminActor } from "@/lib/admin-rbac";
import { actorHasPermission } from "@/lib/admin-rbac";

/** Established hidden-fare display for admins without listings.fare_view. */
export const HIDDEN_LISTING_FARE_DISPLAY = "***";

/**
 * Server-side gate for raw listing fare (requirements.price / exchange_listings.price).
 * requirements.view / exchanges.view / minimum_fares.* / fare_overrides.* do NOT imply this.
 */
export function actorCanViewListingFares(
  actor: AdminActor | null | undefined,
): boolean {
  return Boolean(
    actor &&
      actor.isActive &&
      actorHasPermission(actor, "listings.fare_view"),
  );
}

/** Non-fare requirement columns used by the Admin dashboard. */
export const REQUIREMENT_SSR_COLUMNS_BASE = [
  "id",
  "source_city",
  "source_state",
  "destination_city",
  "destination_state",
  "car_type",
  "trip_type",
  "journey_start_at",
  "ride_type",
  "created_at",
  "booked",
  "booking_remark",
  "user_id",
  "assigned_to_user_id",
] as const;

/** Non-fare exchange columns used by the Admin dashboard. */
export const EXCHANGE_SSR_COLUMNS_BASE = [
  "id",
  "available_source_city",
  "available_source_state",
  "available_destination_city",
  "available_destination_state",
  "available_car_type",
  "available_trip_type",
  "available_at",
  "expected_source_city",
  "expected_source_state",
  "expected_destination_city",
  "expected_destination_state",
  "expected_car_type",
  "expected_trip_type",
  "expected_at",
  "description",
  "created_at",
  "booked",
  "user_id",
  "exchanged_to_user_id",
] as const;

export function requirementSsrSelect(includePrice: boolean): string {
  const cols = includePrice
    ? [...REQUIREMENT_SSR_COLUMNS_BASE, "price"]
    : [...REQUIREMENT_SSR_COLUMNS_BASE];
  return `
      ${cols.join(",\n      ")},
      users!requirements_user_id_fkey (
        first_name,
        last_name,
        phone
      ),
      assigned_user:users!requirements_assigned_to_user_id_fkey (
        first_name,
        last_name,
        phone
      )
    `;
}

export function exchangeSsrSelect(includePrice: boolean): string {
  const cols = includePrice
    ? [...EXCHANGE_SSR_COLUMNS_BASE, "price"]
    : [...EXCHANGE_SSR_COLUMNS_BASE];
  return `
    ${cols.join(",\n    ")},
    users!exchange_listings_user_id_fkey (
      first_name,
      last_name,
      phone
    ),
    exchanged_user:users!exchange_listings_exchanged_to_user_id_fkey (
      first_name,
      last_name,
      phone
    )
  `;
}

/** Strip price from listing rows before they become client props. */
export function stripListingPrice(rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return {};
    }
    const copy = { ...(row as Record<string, unknown>) };
    delete copy.price;
    return copy;
  });
}

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
