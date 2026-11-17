import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";

/** Lightweight counts for dashboard cards — avoids loading full tables. */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("minimum_fares.view", {
    request,
    auditModule: "minimum_fares",
  });
  if (!gate.ok) return gate.response;

  const [
    rulesTotal,
    rulesActive,
    pendingRequests,
    activeOverrides,
    expiredOverrides,
  ] = await Promise.all([
    gate.supabase
      .from("route_minimum_fares")
      .select("id", { count: "exact", head: true }),
    gate.supabase
      .from("route_minimum_fares")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    gate.supabase
      .from("fare_override_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    gate.supabase
      .from("user_fare_overrides")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved"),
    gate.supabase
      .from("user_fare_overrides")
      .select("id", { count: "exact", head: true })
      .eq("status", "expired"),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      minimumFareRules: rulesTotal.count ?? 0,
      activeRules: rulesActive.count ?? 0,
      pendingFareRequests: pendingRequests.count ?? 0,
      activeUserOverrides: activeOverrides.count ?? 0,
      expiredOverrides: expiredOverrides.count ?? 0,
    },
  });
}
