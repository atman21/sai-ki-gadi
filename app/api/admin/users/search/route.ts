import { NextResponse } from "next/server";

import { requireAdminApi, safeErrorMessage } from "@/lib/admin-api";

function escapeIlike(value: string): string {
  return value.replace(/[%_,\\]/g, "");
}

function buildSearchOr(q: string): string {
  const escaped = escapeIlike(q);
  const parts = [
    `first_name.ilike.%${escaped}%`,
    `last_name.ilike.%${escaped}%`,
    `business_name.ilike.%${escaped}%`,
  ];

  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4) {
    parts.push(`phone.ilike.%${digits}%`);
  } else if (escaped) {
    parts.push(`phone.ilike.%${escaped}%`);
  }
  if (digits.length === 10) {
    parts.push(`phone.eq.+91${digits}`);
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    parts.push(`phone.eq.+${digits}`);
  }

  return parts.join(",");
}

/**
 * Admin user search for Wallet / Membership management tabs.
 * Matches name, phone/mobile, or business_name (case-insensitive contains).
 */
export async function GET(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({
      ok: true,
      users: [] as Array<Record<string, unknown>>,
    });
  }

  const selectWithBusiness =
    "id, first_name, last_name, phone, business_name, membership_type, membership_started_at, membership_expires_at, membership_duration_days, status, trip_points";
  const selectWithoutBusiness =
    "id, first_name, last_name, phone, membership_type, membership_started_at, membership_expires_at, membership_duration_days, status, trip_points";

  const { data, error } = await gate.supabase
    .from("users")
    .select(selectWithBusiness)
    .or(buildSearchOr(q))
    .order("first_name", { ascending: true })
    .limit(25);

  if (error) {
    if (/business_name/i.test(error.message)) {
      const fallbackOr = buildSearchOr(q)
        .split(",")
        .filter((part) => !part.startsWith("business_name."))
        .join(",");
      const fallback = await gate.supabase
        .from("users")
        .select(selectWithoutBusiness)
        .or(fallbackOr)
        .order("first_name", { ascending: true })
        .limit(25);

      if (fallback.error) {
        return NextResponse.json(
          {
            ok: false,
            error: safeErrorMessage(fallback.error, "Unable to search users."),
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        ok: true,
        users: (fallback.data ?? []).map((user) => ({
          ...user,
          business_name: null,
          full_name:
            `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "User",
        })),
      });
    }

    return NextResponse.json(
      { ok: false, error: safeErrorMessage(error, "Unable to search users.") },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    users: (data ?? []).map((user) => ({
      ...user,
      full_name:
        `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "User",
    })),
  });
}
