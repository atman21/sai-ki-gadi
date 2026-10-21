import { NextResponse } from "next/server";

import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";

export async function GET(request: Request) {
  const gate = await requireAdminPermission("audit_logs.view", {
    request,
    auditModule: "audit",
  });
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const action = (searchParams.get("action") ?? "").trim();
  const module = (searchParams.get("module") ?? "").trim();
  const actorId = (searchParams.get("actorId") ?? "").trim();
  const resourceId = (searchParams.get("resourceId") ?? "").trim();
  const successParam = (searchParams.get("success") ?? "").trim();
  const dateFrom = (searchParams.get("dateFrom") ?? "").trim();
  const dateTo = (searchParams.get("dateTo") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get("pageSize") ?? "40") || 40),
  );
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = gate.supabase
    .from("admin_panel_audit_logs")
    .select(
      `
      id,
      created_at,
      actor_id,
      actor_username,
      actor_display_name,
      actor_is_super_admin,
      action,
      module,
      resource_type,
      resource_id,
      description,
      success,
      changed_fields,
      before_data,
      after_data,
      metadata,
      request_id,
      ip_address
    `,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (action) query = query.eq("action", action);
  if (module) query = query.eq("module", module);
  if (actorId) query = query.eq("actor_id", actorId);
  if (resourceId) query = query.eq("resource_id", resourceId);
  if (successParam === "true") query = query.eq("success", true);
  if (successParam === "false") query = query.eq("success", false);
  if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(
      `description.ilike.${pattern},actor_username.ilike.${pattern},actor_display_name.ilike.${pattern},resource_id.ilike.${pattern},action.ilike.${pattern}`,
    );
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load audit logs."),
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  });
}
