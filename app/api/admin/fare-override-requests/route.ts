import { NextResponse } from "next/server";

import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";

export async function GET(request: Request) {
  const gate = await requireAdminPermission("fare_overrides.view", {
    request,
    auditModule: "fare_overrides",
  });
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const vehicle = (searchParams.get("vehicle") ?? "").trim();
  const status = (searchParams.get("status") ?? "pending").trim();
  const dateFrom = (searchParams.get("dateFrom") ?? "").trim();
  const dateTo = (searchParams.get("dateTo") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get("pageSize") ?? "30") || 30),
  );
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = gate.supabase
    .from("fare_override_requests")
    .select(
      `
      id,
      user_id,
      from_city,
      from_state,
      to_city,
      to_state,
      vehicle_category,
      normal_min_fare,
      requested_fare,
      reason,
      status,
      rejection_reason,
      reviewed_at,
      reviewed_by,
      created_at,
      updated_at,
      users!fare_override_requests_user_id_fkey (
        id,
        first_name,
        last_name,
        phone
      )
    `,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status && status !== "all") {
    query = query.eq("status", status);
  }
  if (vehicle) {
    query = query.ilike("vehicle_category", vehicle);
  }
  if (dateFrom) {
    query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  }
  if (dateTo) {
    query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
  }
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(
      `from_city.ilike.${pattern},to_city.ilike.${pattern},vehicle_category.ilike.${pattern}`,
    );
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Unable to load fare override requests."),
      },
      { status: 400 },
    );
  }

  // Optional phone/name filter client-side when q matches user fields
  // (PostgREST nested or-filter is limited). Re-fetch user matches if needed.
  let rows = data ?? [];
  if (q) {
    const ql = q.toLowerCase();
    const needsUserFilter = rows.some(() => true);
    if (needsUserFilter) {
      const { data: matchedUsers } = await gate.supabase
        .from("users")
        .select("id, first_name, last_name, phone")
        .or(
          `first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`,
        )
        .limit(200);

      const userIds = new Set((matchedUsers ?? []).map((u) => u.id));
      if (userIds.size > 0) {
        const { data: extra, error: extraErr } = await gate.supabase
          .from("fare_override_requests")
          .select(
            `
            id,
            user_id,
            from_city,
            from_state,
            to_city,
            to_state,
            vehicle_category,
            normal_min_fare,
            requested_fare,
            reason,
            status,
            rejection_reason,
            reviewed_at,
            reviewed_by,
            created_at,
            updated_at,
            users!fare_override_requests_user_id_fkey (
              id,
              first_name,
              last_name,
              phone
            )
          `,
          )
          .in("user_id", [...userIds])
          .order("created_at", { ascending: false })
          .limit(pageSize);

        if (!extraErr && extra) {
          const byId = new Map<string, (typeof rows)[number]>();
          for (const r of rows) byId.set(r.id, r);
          for (const r of extra) byId.set(r.id, r);
          rows = [...byId.values()].filter((r) => {
            const u = Array.isArray(r.users) ? r.users[0] : r.users;
            const name = `${u?.first_name ?? ""} ${u?.last_name ?? ""}`.toLowerCase();
            const phone = String(u?.phone ?? "").toLowerCase();
            const cityMatch =
              r.from_city.toLowerCase().includes(ql) ||
              r.to_city.toLowerCase().includes(ql);
            return (
              cityMatch ||
              name.includes(ql) ||
              phone.includes(ql) ||
              r.vehicle_category.toLowerCase().includes(ql)
            );
          });
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    data: rows,
    total: count ?? rows.length,
    page,
    pageSize,
  });
}
