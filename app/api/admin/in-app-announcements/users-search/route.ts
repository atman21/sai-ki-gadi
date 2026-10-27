import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeIlike(value: string): string {
  return value.replace(/[%_,\\]/g, "");
}

function buildLegacySearchOr(q: string): string {
  const escaped = escapeIlike(q);
  const parts = [
    `first_name.ilike.%${escaped}%`,
    `last_name.ilike.%${escaped}%`,
  ];

  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4) {
    parts.push(`phone.ilike.%${digits}%`);
  }
  if (digits.length === 10) {
    parts.push(`phone.eq.+91${digits}`);
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    parts.push(`phone.eq.+${digits}`);
  }
  if (UUID_RE.test(q)) {
    parts.push(`id.eq.${q}`);
  }

  return parts.join(",");
}

export async function GET(request: Request) {
  const auth = await requireAdminPermission("announcements.manage", {
    request,
    auditModule: "announcements",
  });
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const membership = searchParams.get("membership") ?? "all";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const pageSize = Math.min(
    50,
    Math.max(10, Number(searchParams.get("pageSize") ?? searchParams.get("limit") ?? 20)),
  );
  const offset = (page - 1) * pageSize;

  const { data: rpcRows, error: rpcError } = await auth.supabase.rpc(
    "admin_search_announcement_users",
    {
      p_q: q,
      p_membership: membership,
      p_limit: pageSize,
      p_offset: offset,
    },
  );

  if (!rpcError && Array.isArray(rpcRows)) {
    const users = rpcRows.map((u) => ({
      id: u.id,
      fullName: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || "—",
      phone: u.phone ?? "—",
      email: u.email ?? "—",
      membership_type: u.membership_type ?? "user",
      verified: Boolean(u.verified),
      status: Boolean(u.status ?? true),
    }));

    const { data: countRows, error: countError } = await auth.supabase.rpc(
      "admin_search_announcement_users",
      {
        p_q: q,
        p_membership: membership,
        p_limit: 10000,
        p_offset: 0,
      },
    );

    const total = countError ? users.length : (countRows?.length ?? users.length);

    return NextResponse.json({
      ok: true,
      users,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  }

  // Fallback when RPC is not deployed yet (Testing before migration 048).
  let query = auth.supabase
    .from("users")
    .select(
      "id, first_name, last_name, phone, email, membership_type, verified, status",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (q) {
    query = query.or(buildLegacySearchOr(q));
  }

  if (membership !== "all") {
    query = query.eq("membership_type", membership);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  const users = (data ?? []).map((u) => ({
    id: u.id,
    fullName: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || "—",
    phone: u.phone ?? "—",
    email: u.email ?? "—",
    membership_type: u.membership_type ?? "user",
    verified: Boolean(u.verified),
    status: u.status ?? true,
  }));

  return NextResponse.json({
    ok: true,
    users,
    page,
    pageSize,
    total: count ?? 0,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  });
}
