import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";

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

  // Fail closed: do not silently query the users table when the privileged
  // search RPC is unavailable. The caller remains RBAC-checked above.
  return NextResponse.json(
    { ok: false, error: "Announcement user search is temporarily unavailable." },
    { status: 503 },
  );
}
