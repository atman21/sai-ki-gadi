import type { Metadata } from "next";
import { Suspense } from "react";

import { supabaseAdmin, usingServiceRole, serviceRoleConfigIssue, supabaseProjectHost } from "@/lib/supabase-admin";

import { DashboardTabs, type ProfileChangeRequestRow, type VehicleVerificationRow, type RouteMinimumFareRow } from "./dashboard-tabs";

export const metadata: Metadata = {
  title: "Dashboard | Sai ki Gadi Admin",
  description: "Admin dashboard for profile verification.",
};

export const dynamic = "force-dynamic";

type UserRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  membership_type: string | null;
  membership_started_at: string | null;
  membership_expires_at: string | null;
  membership_duration_days: number | null;
  verified: boolean | null;
  status: boolean | null;
  verification_status: string | null;
  created_at: string | null;
  welcome_completed: boolean | null;
  admin_remarks: string | null;
  last_active_at: string | null;
  rating_average: number | null;
  rating_count: number | null;
  blood_group: string | null;
  birth_date: string | null;
  date_of_birth: string | null;
  reference_1_name: string | null;
  reference_1_mobile: string | null;
  reference_2_name: string | null;
  reference_2_mobile: string | null;
  user_roles: string[] | null;
  requirement_count: number;
  exchange_count: number;
  availability_count: number;
  driver_requirement_count: number;
  total_posts: number;
  trip_points: number;
  trips_assigned_by: number;
  trips_assigned_to: number;
};

type UserIdRow = { user_id: string };

type TripAssignmentRow = { user_id: string; assigned_id: string | null };

async function fetchAllTripAssignments(table: "requirements" | "exchange_listings", assignedColumn: "assigned_to_user_id" | "exchanged_to_user_id"): Promise<TripAssignmentRow[]> {
  const result: TripAssignmentRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table)
      .select(`user_id,${assignedColumn}`).eq("booked", true)
      .not(assignedColumn, "is", null).range(from, from + 999);
    if (error) throw new Error(`Unable to load assignments: ${error.message}`);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    result.push(...rows.map(row => ({ user_id: String(row.user_id), assigned_id: row[assignedColumn] ? String(row[assignedColumn]) : null })));
    if (rows.length < 1000) break;
  }
  return result;
}

function countAssignments(rows: TripAssignmentRow[], field: "user_id" | "assigned_id"): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const id = row[field]; if (!id) continue;
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

function countByUserId(rows: UserIdRow[] | null | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    if (!row.user_id) continue;
    counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  }
  return counts;
}

async function fetchAllUserIds(table: string): Promise<UserIdRow[]> {
  const pageSize = 1000;
  let from = 0;
  const all: UserIdRow[] = [];

  while (true) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("user_id")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Unable to fetch ${table} owners: ${error.message}`);
    }

    const rows = (data ?? []) as UserIdRow[];
    all.push(...rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

type IdentityDocRow = {
  user_id: string;
  aadhaar_number?: string | null;
  aadhaar_uploaded?: boolean | null;
  pan_uploaded?: boolean | null;
  gst_uploaded?: boolean | null;
  aadhaar_file_path?: string | null;
  pan_file_path?: string | null;
  gst_file_path?: string | null;
  driving_license_front_path?: string | null;
  driving_license_back_path?: string | null;
  aadhaar_front_path?: string | null;
  aadhaar_back_path?: string | null;
};

// type MembershipCounts = {
//   user: number;
//   pro: number;
//   pro_plus: number;
// };

type MembershipCounts = {
  regular: number;
  silver: number;
  gold: number;
  platinum: number;
};

type PendingVerificationUser = {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  membershipType: "regular" | "silver" | "gold" | "platinum";
};

function normalizeMembership(
  value: string | null,
): "regular" | "silver" | "gold" | "platinum" {
  if (
    value === "regular" ||
    value === "silver" ||
    value === "gold" ||
    value === "platinum"
  ) {
    return value;
  }

  return "regular";
}

function hasAnyUploadedDocs(row: IdentityDocRow): boolean {
  const modern =
    Boolean(row.driving_license_front_path) ||
    Boolean(row.driving_license_back_path) ||
    Boolean(row.aadhaar_front_path) ||
    Boolean(row.aadhaar_back_path);
  if (modern) return true;

  const flags =
    Boolean(row.aadhaar_uploaded) ||
    Boolean(row.pan_uploaded) ||
    Boolean(row.gst_uploaded);
  if (flags) return true;

  return Boolean(
    row.aadhaar_file_path || row.pan_file_path || row.gst_file_path,
  );
}

function hasAadhaarNumber(row: IdentityDocRow): boolean {
  return Boolean(row.aadhaar_number?.trim());
}

function hasAllRequiredDocs(row: IdentityDocRow): boolean {
  const modern =
    Boolean(row.driving_license_front_path) &&
    Boolean(row.driving_license_back_path) &&
    Boolean(row.aadhaar_front_path) &&
    Boolean(row.aadhaar_back_path);
  if (modern) return true;

  const legacyFlags =
    Boolean(row.aadhaar_uploaded) &&
    Boolean(row.pan_uploaded) &&
    Boolean(row.gst_uploaded);
  if (legacyFlags) return true;

  return Boolean(
    row.aadhaar_file_path && row.pan_file_path && row.gst_file_path,
  );
}

function fullNameOf(user: UserRow): string {
  const fromParts = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  if (fromParts) return fromParts;
  if (user.email) return user.email;
  if (user.phone) return user.phone;
  return "Unknown user";
}

export default async function DashboardPage() {
  const [
    { data: users, error: usersError },
    docsResult,
    requirementOwnerIds,
    exchangeOwnerIds,
    availabilityOwnerIds,
    driverOwnerIds,
    assignedRequirements,
    assignedExchanges,
  ] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select(
        "id, first_name, last_name, phone, email, membership_type,membership_started_at,membership_expires_at,membership_duration_days, verified, status, verification_status, created_at, welcome_completed, admin_remarks, last_active_at, rating_average, rating_count, trip_points, blood_group, birth_date, date_of_birth, reference_1_name, reference_1_mobile, reference_2_name, reference_2_mobile, user_roles",
      ),
    (async () => {
      // Prefer current mobile schema columns.
      const modern = await supabaseAdmin
        .from("user_identity_documents")
        .select(
          "user_id, aadhaar_number, driving_license_front_path, driving_license_back_path, aadhaar_front_path, aadhaar_back_path",
        );
      if (!modern.error) return modern;

      // Fallback to schema.sql columns.
      return supabaseAdmin
        .from("user_identity_documents")
        .select(
          "user_id, aadhaar_number, aadhaar_uploaded, pan_uploaded, gst_uploaded, aadhaar_file_path, pan_file_path, gst_file_path",
        );
    })(),
    fetchAllUserIds("requirements"),
    fetchAllUserIds("exchange_listings"),
    fetchAllUserIds("cab_avail_listings"),
    fetchAllUserIds("driver_listings"),
    fetchAllTripAssignments("requirements", "assigned_to_user_id"),
    fetchAllTripAssignments("exchange_listings", "exchanged_to_user_id"),
  ]);
  const { data: docs, error: docsError } = docsResult;

  if (usersError) {
    throw new Error(`Unable to fetch users: ${usersError.message}`);
  }
  if (docsError) {
    throw new Error(
      `Unable to fetch verification documents: ${docsError.message}`,
    );
  }

  const requirementCounts = countByUserId(requirementOwnerIds);
  const exchangeCounts = countByUserId(exchangeOwnerIds);
  const availabilityCounts = countByUserId(availabilityOwnerIds);
  const driverCounts = countByUserId(driverOwnerIds);

  const allAssignments = [...assignedRequirements, ...assignedExchanges];
  const countsByPoster = countAssignments(allAssignments, "user_id");
  const countsByAssignee = countAssignments(allAssignments, "assigned_id");
  const allUsers: UserRow[] = (users ?? []).map((user) => {
    const requirement_count = requirementCounts.get(user.id) ?? 0;
    const exchange_count = exchangeCounts.get(user.id) ?? 0;
    const availability_count = availabilityCounts.get(user.id) ?? 0;
    const driver_requirement_count = driverCounts.get(user.id) ?? 0;

    return {
      ...user,
      welcome_completed: user.welcome_completed ?? false,
      admin_remarks: user.admin_remarks ?? null,
      last_active_at: user.last_active_at ?? null,
      rating_average: user.rating_average ?? null,
      rating_count: user.rating_count ?? null,
      blood_group: user.blood_group ?? null,
      birth_date: user.birth_date ?? null,
      date_of_birth: user.date_of_birth ?? null,
      reference_1_name: user.reference_1_name ?? null,
      reference_1_mobile: user.reference_1_mobile ?? null,
      reference_2_name: user.reference_2_name ?? null,
      reference_2_mobile: user.reference_2_mobile ?? null,
      user_roles: Array.isArray(user.user_roles) ? user.user_roles : null,
      requirement_count,
      exchange_count,
      availability_count,
      driver_requirement_count,
      trip_points: Number(user.trip_points ?? 0),
      trips_assigned_by: countsByPoster.get(user.id) ?? 0,
      trips_assigned_to: countsByAssignee.get(user.id) ?? 0,
      total_posts:
        requirement_count +
        exchange_count +
        availability_count +
        driver_requirement_count,
    };
  });
  const allDocs: IdentityDocRow[] = docs ?? [];

  const membership: MembershipCounts = {
    regular: 0,
    silver: 0,
    gold: 0,
    platinum: 0,
  };
  let verifiedCount = 0;
  let unverifiedCount = 0;

  for (const user of allUsers) {
    const normalized = normalizeMembership(user.membership_type);
    membership[normalized] += 1;
    if (user.verified) verifiedCount += 1;
    else unverifiedCount += 1;
  }

  const docsByUserId = new Map(allDocs.map((row) => [row.user_id, row]));
  const uploadedDocUserIds = new Set(
    allDocs.filter(hasAnyUploadedDocs).map((row) => row.user_id),
  );
  const pendingVerificationUsers: PendingVerificationUser[] = allUsers
    .filter((user) => {
      const row = docsByUserId.get(user.id);

      return (
        user.verification_status === "pending" && row && hasAnyUploadedDocs(row)
      );
    })
    .map((user) => ({
      id: user.id,
      fullName: fullNameOf(user),
      phone: user.phone ?? "—",
      email: user.email ?? "—",
      membershipType: normalizeMembership(user.membership_type),
    }));
  const rejectedPartialUsers: PendingVerificationUser[] = allUsers
    .filter((user) => user.verification_status === "rejected")
    .map((user) => ({
      id: user.id,
      fullName: fullNameOf(user),
      phone: user.phone ?? "—",
      email: user.email ?? "—",
      membershipType: normalizeMembership(user.membership_type),
    }));
  const notStartedVerificationUsers: PendingVerificationUser[] = allUsers
    .filter((user) => {
      return (
        user.verification_status === "pending" &&
        !uploadedDocUserIds.has(user.id)
      );
    })
    .map((user) => ({
      id: user.id,
      fullName: fullNameOf(user),
      phone: user.phone ?? "—",
      email: user.email ?? "—",
      membershipType: normalizeMembership(user.membership_type),
    }));

  const usersById = new Map(
    (allUsers ?? []).map((u) => [
      u.id,
      {
        first_name: u.first_name,
        last_name: u.last_name,
        phone: u.phone,
      },
    ]),
  );

  // Second wave: all independent module datasets in parallel (was sequential).
  const [
    winnersResult,
    citiesResult,
    slidersResult,
    prioritySettingsResult,
    luckyDrawResult,
    birthdayNotifResult,
    requirementsResult,
    exchangesResult,
    fraudReportsResult,
    profileChangeRequestsResult,
    vehiclesResult,
    routeMinimumFaresResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("winners")
      .select(
        `
    *,
    users (
      first_name,
      last_name,
      phone
    )
  `,
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabaseAdmin.from("cities").select("*").order("city", { ascending: true }),
    supabaseAdmin
      .from("sliders")
      .select("*")
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false }),
    // Legacy columns: all_platinum=Diamond, all_gold=Gold, matching_platinum=Silver
    supabaseAdmin
      .from("requirement_priority_settings")
      .select(
        "matching_platinum_minutes, all_platinum_minutes, all_gold_minutes, updated_at",
      )
      .eq("id", 1)
      .maybeSingle(),
    supabaseAdmin
      .from("lucky_draw_notification_settings")
      .select("id, enabled, slots, updated_at")
      .eq("id", 1)
      .maybeSingle(),
    supabaseAdmin
      .from("birthday_notification_settings")
      .select("id, enabled, send_time, updated_at")
      .eq("id", 1)
      .maybeSingle(),
    supabaseAdmin
      .from("requirements")
      .select(
        `
      *,
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
    `,
      )
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("exchange_listings")
      .select(
        `
    *,
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
  `,
      )
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("fraud_reports")
      .select(
        `
    *,
    from_user:users!fraud_reports_from_user_id_fkey (
      first_name,
      last_name,
      phone
    ),
    to_user:users!fraud_reports_to_user_id_fkey (
      first_name,
      last_name,
      phone
    )
  `,
      )
      .order("created_at", { ascending: false })
      .limit(300),
    supabaseAdmin
      .from("profile_change_requests")
      .select(
        `
      id,
      user_id,
      status,
      requested_changes,
      rejection_reason,
      requested_at,
      reviewed_at,
      reviewed_by
    `,
      )
      .order("requested_at", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("user_vehicles")
      .select(
        `
      id,
      user_id,
      registration_number,
      normalized_registration_number,
      verification_status,
      rejection_reason,
      created_at,
      reviewed_at,
      reviewed_by
    `,
      )
      .order("created_at", { ascending: false })
      .limit(300),
    supabaseAdmin
      .from("route_minimum_fares")
      .select(
        `
      id,
      from_city,
      from_state,
      to_city,
      to_state,
      vehicle_category,
      minimum_fare,
      is_active,
      created_at,
      updated_at
    `,
      )
      .order("updated_at", { ascending: false })
      .limit(500),
  ]);

  const winners = winnersResult.data;
  const cities = citiesResult.data;
  const sliders = slidersResult.data;
  const prioritySettingsRow = prioritySettingsResult.data;
  const luckyDrawNotificationSettingsRow = luckyDrawResult.data;
  const birthdayNotificationSettingsRow = birthdayNotifResult.data;
  const requirements = requirementsResult.data;
  const exchanges = exchangesResult.data;
  const fraudReports = fraudReportsResult.data;
  const profileChangeRequestRows = profileChangeRequestsResult.data;
  const profileChangeRequestsError = profileChangeRequestsResult.error;
  const vehicleRows = vehiclesResult.data;
  const vehiclesError = vehiclesResult.error;
  let routeMinimumFareRows = routeMinimumFaresResult.data;
  let routeMinimumFaresError = routeMinimumFaresResult.error;

  // Pre-migration fallback: column vehicle_category may not exist yet.
  if (
    routeMinimumFaresError?.message
      ?.toLowerCase()
      .includes("vehicle_category")
  ) {
    const retry = await supabaseAdmin
      .from("route_minimum_fares")
      .select(
        `
      id,
      from_city,
      from_state,
      to_city,
      to_state,
      minimum_fare,
      is_active,
      created_at,
      updated_at
    `,
      )
      .order("updated_at", { ascending: false })
      .limit(500);
    routeMinimumFareRows = retry.data as typeof routeMinimumFareRows;
    routeMinimumFaresError = retry.error;
  }

  // Fare override tables may not exist until migration 052 is applied.
  const [
    pendingFareRequestsCountResult,
    activeRulesCountResult,
    activeOverridesCountResult,
    expiredOverridesCountResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("fare_override_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabaseAdmin
      .from("route_minimum_fares")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabaseAdmin
      .from("user_fare_overrides")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved"),
    supabaseAdmin
      .from("user_fare_overrides")
      .select("id", { count: "exact", head: true })
      .eq("status", "expired"),
  ]);

  const prioritySettings = {
    matching_platinum_minutes:
      prioritySettingsRow?.matching_platinum_minutes ?? 4,
    all_platinum_minutes: prioritySettingsRow?.all_platinum_minutes ?? 4,
    all_gold_minutes: prioritySettingsRow?.all_gold_minutes ?? 3,
    updated_at: prioritySettingsRow?.updated_at ?? null,
  };

  const luckyDrawNotificationSettings = {
    id: 1 as const,
    enabled: luckyDrawNotificationSettingsRow?.enabled ?? true,
    slots: Array.isArray(luckyDrawNotificationSettingsRow?.slots)
      ? (luckyDrawNotificationSettingsRow.slots as string[])
      : ["10:00", "14:00", "18:00", "21:00"],
    updated_at: luckyDrawNotificationSettingsRow?.updated_at ?? null,
  };

  const birthdayNotificationSettings = {
    id: 1 as const,
    enabled: birthdayNotificationSettingsRow?.enabled ?? true,
    send_time:
      typeof birthdayNotificationSettingsRow?.send_time === "string" &&
      birthdayNotificationSettingsRow.send_time.trim()
        ? birthdayNotificationSettingsRow.send_time
        : "09:00",
    updated_at: birthdayNotificationSettingsRow?.updated_at ?? null,
  };

  const profileChangeRequests: ProfileChangeRequestRow[] = (
    profileChangeRequestRows ?? []
  ).map((row) => ({
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    requested_changes: row.requested_changes,
    rejection_reason: row.rejection_reason,
    requested_at: row.requested_at,
    reviewed_at: row.reviewed_at,
    reviewed_by: row.reviewed_by,
    users: usersById.get(row.user_id) ?? null,
  }));

  const vehicles: VehicleVerificationRow[] = (vehicleRows ?? []).map((row) => ({
    id: row.id,
    user_id: row.user_id,
    registration_number: row.registration_number,
    normalized_registration_number: row.normalized_registration_number,
    verification_status: row.verification_status,
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
    reviewed_by: row.reviewed_by,
    users: usersById.get(row.user_id) ?? null,
  }));

  const routeMinimumFares: RouteMinimumFareRow[] = (
    routeMinimumFareRows ?? []
  ).map((row) => ({
    id: row.id,
    from_city: row.from_city,
    from_state: row.from_state,
    to_city: row.to_city,
    to_state: row.to_state,
    vehicle_category:
      "vehicle_category" in row
        ? ((row as { vehicle_category?: string | null }).vehicle_category ??
          null)
        : null,
    minimum_fare: Number(row.minimum_fare),
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  const fareStats = {
    minimumFareRules: routeMinimumFares.length,
    activeRules: activeRulesCountResult.error
      ? routeMinimumFares.filter((r) => r.is_active).length
      : (activeRulesCountResult.count ?? 0),
    pendingFareRequests: pendingFareRequestsCountResult.error
      ? 0
      : (pendingFareRequestsCountResult.count ?? 0),
    activeUserOverrides: activeOverridesCountResult.error
      ? 0
      : (activeOverridesCountResult.count ?? 0),
    expiredOverrides: expiredOverridesCountResult.error
      ? 0
      : (expiredOverridesCountResult.count ?? 0),
  };

  return (
    <div className="min-h-screen">
      <main className="mx-auto w-full max-w-[1480px] px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
        <Suspense
          fallback={
            <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          }
        >
        <DashboardTabs
          totalUsers={allUsers.length}
          membership={membership}
          verifiedCount={verifiedCount}
          unverifiedCount={unverifiedCount}
          pendingVerificationUsers={pendingVerificationUsers}
          rejectedPartialUsers={rejectedPartialUsers}
          notStartedVerificationUsers={notStartedVerificationUsers}
          showRlsHint={!usingServiceRole}
          serviceRoleIssue={serviceRoleConfigIssue()}
          supabaseHost={supabaseProjectHost()}
          profileChangeRequestsError={
            profileChangeRequestsError?.message ?? null
          }
          vehiclesError={vehiclesError?.message ?? null}
          routeMinimumFaresError={routeMinimumFaresError?.message ?? null}
          winnerUser={winners ?? []}
          cities={cities ?? []}
          sliders={sliders ?? []}
          users={allUsers ?? []}
          requirements={requirements ?? []}
          exchanges={exchanges ?? []}
          fraudReports={fraudReports ?? []}
          prioritySettings={prioritySettings}
          luckyDrawNotificationSettings={luckyDrawNotificationSettings}
          birthdayNotificationSettings={birthdayNotificationSettings}
          profileChangeRequests={profileChangeRequests}
          vehicles={vehicles}
          routeMinimumFares={routeMinimumFares}
          fareStats={fareStats}
        />
        </Suspense>
      </main>
    </div>
  );
}
