import { NextResponse } from "next/server";

import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  writeAdminAuditLog,
} from "@/lib/admin-audit";

const LIST_COLUMNS = `
  id,
  created_at,
  actor_id,
  actor_username,
  actor_display_name,
  actor_is_super_admin,
  actor_role,
  action,
  module,
  resource_type,
  resource_id,
  entity_label,
  related_user_id,
  description,
  success,
  outcome,
  reason,
  changed_fields,
  before_data,
  after_data,
  metadata,
  request_id,
  ip_address,
  user_agent,
  http_method,
  route_name
`;

const LEGACY_LIST_COLUMNS = `
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
`;

function parseFilters(searchParams: URLSearchParams) {
  return {
    q: (searchParams.get("q") ?? "").trim(),
    action: (searchParams.get("action") ?? "").trim(),
    moduleFilter: (searchParams.get("module") ?? "").trim(),
    actorId: (searchParams.get("actorId") ?? "").trim(),
    actor: (searchParams.get("actor") ?? "").trim(),
    resourceType: (searchParams.get("resourceType") ?? "").trim(),
    resourceId: (searchParams.get("resourceId") ?? "").trim(),
    relatedUserId: (searchParams.get("relatedUserId") ?? "").trim(),
    requestId: (searchParams.get("requestId") ?? "").trim(),
    outcome: (searchParams.get("outcome") ?? "").trim(),
    successParam: (searchParams.get("success") ?? "").trim(),
    dateFrom: (searchParams.get("dateFrom") ?? "").trim(),
    dateTo: (searchParams.get("dateTo") ?? "").trim(),
    page: Math.max(1, Number(searchParams.get("page") ?? "1") || 1),
    pageSize: Math.min(
      100,
      Math.max(1, Number(searchParams.get("pageSize") ?? "40") || 40),
    ),
  };
}

type FilterShape = ReturnType<typeof parseFilters>;

type AuditLogRow = {
  id?: string;
  created_at?: string | null;
  actor_display_name?: string | null;
  actor_username?: string | null;
  actor_role?: string | null;
  module?: string | null;
  action?: string | null;
  description?: string | null;
  outcome?: string | null;
  success?: boolean | null;
  resource_type?: string | null;
  resource_id?: string | null;
  entity_label?: string | null;
  related_user_id?: string | null;
  request_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  before_data?: unknown;
  after_data?: unknown;
  metadata?: unknown;
  [key: string]: unknown;
};

function applyFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  filters: FilterShape,
  options?: { skipPagination?: boolean; legacy?: boolean },
) {
  const legacy = Boolean(options?.legacy);
  let next = query;
  if (filters.action) next = next.eq("action", filters.action);
  if (filters.moduleFilter) next = next.eq("module", filters.moduleFilter);
  if (filters.actorId) next = next.eq("actor_id", filters.actorId);
  if (filters.resourceType) next = next.eq("resource_type", filters.resourceType);
  if (filters.resourceId) next = next.eq("resource_id", filters.resourceId);
  if (!legacy && filters.relatedUserId) {
    next = next.eq("related_user_id", filters.relatedUserId);
  }
  if (filters.requestId) next = next.eq("request_id", filters.requestId);
  if (!legacy && filters.outcome) next = next.eq("outcome", filters.outcome);
  if (filters.successParam === "true") next = next.eq("success", true);
  if (filters.successParam === "false") next = next.eq("success", false);
  if (filters.dateFrom) {
    next = next.gte("created_at", `${filters.dateFrom}T00:00:00.000Z`);
  }
  if (filters.dateTo) {
    next = next.lte("created_at", `${filters.dateTo}T23:59:59.999Z`);
  }
  if (filters.actor) {
    const pattern = `%${filters.actor}%`;
    next = next.or(
      `actor_username.ilike.${pattern},actor_display_name.ilike.${pattern}`,
    );
  }
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    const clauses = [
      `description.ilike.${pattern}`,
      `actor_username.ilike.${pattern}`,
      `actor_display_name.ilike.${pattern}`,
      `resource_id.ilike.${pattern}`,
      `action.ilike.${pattern}`,
      `request_id.ilike.${pattern}`,
    ];
    if (!legacy) {
      clauses.push(
        `entity_label.ilike.${pattern}`,
        `related_user_id.ilike.${pattern}`,
      );
    }
    next = next.or(clauses.join(","));
  }
  next = next.order("created_at", { ascending: false });
  if (!options?.skipPagination) {
    const from = (filters.page - 1) * filters.pageSize;
    const to = from + filters.pageSize - 1;
    next = next.range(from, to);
  }
  return next;
}

function csvEscape(value: unknown): string {
  const raw = value == null ? "" : String(value);
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export async function GET(request: Request) {
  const gate = await requireAdminPermission("audit_logs.view", {
    request,
    auditModule: "audit",
  });
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(request.url);
  const filters = parseFilters(searchParams);
  const wantSummary = searchParams.get("summary") === "1";
  const wantExport = searchParams.get("export") === "csv";

  if (wantExport) {
    if (
      !gate.actor.isSuperAdmin &&
      !gate.actor.permissions.has("audit_logs.export")
    ) {
      return NextResponse.json(
        { ok: false, error: "Forbidden — audit export permission required." },
        { status: 403 },
      );
    }

    const exportQuery = applyFilters(
      gate.supabase
        .from("admin_panel_audit_logs")
        .select(LIST_COLUMNS)
        .limit(5000),
      { ...filters, page: 1, pageSize: 5000 },
      { skipPagination: true },
    );

    let { data, error } = await exportQuery;
    if (error && /outcome|entity_label|actor_role|related_user_id/i.test(error.message)) {
      const legacy = await applyFilters(
        gate.supabase
          .from("admin_panel_audit_logs")
          .select(LEGACY_LIST_COLUMNS)
          .limit(5000),
        { ...filters, page: 1, pageSize: 5000 },
        { skipPagination: true, legacy: true },
      );
      data = legacy.data;
      error = legacy.error;
    }

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to export audit logs."),
        },
        { status: 400 },
      );
    }

    const rows = (data ?? []) as AuditLogRow[];
    const header = [
      "created_at",
      "actor",
      "actor_username",
      "actor_role",
      "module",
      "action",
      "description",
      "outcome",
      "success",
      "resource_type",
      "resource_id",
      "entity_label",
      "related_user_id",
      "request_id",
      "ip_address",
    ];
    const lines = [
      header.join(","),
      ...rows.map((row) =>
        [
          row.created_at,
          row.actor_display_name,
          row.actor_username,
          row.actor_role ?? "",
          row.module,
          row.action,
          row.description,
          row.outcome ?? (row.success ? "success" : "failure"),
          row.success,
          row.resource_type,
          row.resource_id,
          row.entity_label ?? "",
          row.related_user_id ?? "",
          row.request_id,
          row.ip_address,
        ]
          .map(csvEscape)
          .join(","),
      ),
    ];

    void writeAdminAuditLog({
      actor: gate.actor,
      action: "audit_logs_exported",
      module: "audit",
      description: `Exported ${rows.length} audit log row(s)`,
      success: true,
      resourceType: "audit_export",
      metadata: {
        rowCount: rows.length,
        filters: {
          q: filters.q || null,
          action: filters.action || null,
          module: filters.moduleFilter || null,
          outcome: filters.outcome || null,
          dateFrom: filters.dateFrom || null,
          dateTo: filters.dateTo || null,
        },
      },
      ...clientMetaFromRequest(request),
    });

    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-logs-${Date.now()}.csv"`,
      },
    });
  }

  let query = applyFilters(
    gate.supabase
      .from("admin_panel_audit_logs")
      .select(LIST_COLUMNS, { count: "exact" }),
    filters,
  );

  let { data, error, count } = await query;
  if (error && /outcome|entity_label|actor_role|related_user_id/i.test(error.message)) {
    const legacy = await applyFilters(
      gate.supabase
        .from("admin_panel_audit_logs")
        .select(LEGACY_LIST_COLUMNS, { count: "exact" }),
      filters,
      { legacy: true },
    );
    data = legacy.data;
    error = legacy.error;
    count = legacy.count;
  }

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load audit logs."),
      },
      { status: 400 },
    );
  }

  let summary:
    | {
        total: number;
        success: number;
        failure: number;
        security: number;
        recent24h: number;
      }
    | undefined;

  if (wantSummary) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const table = () => gate.supabase.from("admin_panel_audit_logs");

    const [totalRes, successRes, failureRes, securityRes, recentRes] =
      await Promise.all([
        applyFilters(table().select("id", { count: "exact", head: true }), {
          ...filters,
          page: 1,
          pageSize: 1,
        }),
        applyFilters(
          table()
            .select("id", { count: "exact", head: true })
            .eq("success", true),
          { ...filters, page: 1, pageSize: 1, successParam: "" },
        ),
        applyFilters(
          table()
            .select("id", { count: "exact", head: true })
            .eq("success", false),
          { ...filters, page: 1, pageSize: 1, successParam: "" },
        ),
        applyFilters(
          table()
            .select("id", { count: "exact", head: true })
            .in("action", [
              "login_failed",
              "login_rate_limited",
              "permission_denied",
              "logout",
              "login_success",
            ]),
          { ...filters, page: 1, pageSize: 1, action: "" },
        ),
        applyFilters(
          table()
            .select("id", { count: "exact", head: true })
            .gte("created_at", since),
          { ...filters, page: 1, pageSize: 1, dateFrom: "", dateTo: "" },
        ),
      ]);

    summary = {
      total: totalRes.count ?? count ?? 0,
      success: successRes.count ?? 0,
      failure: failureRes.count ?? 0,
      security: securityRes.count ?? 0,
      recent24h: recentRes.count ?? 0,
    };
  }

  const canViewDetails =
    gate.actor.isSuperAdmin ||
    gate.actor.permissions.has("audit_logs.view_details");

  const sanitized = ((data ?? []) as AuditLogRow[]).map((row) => {
    if (canViewDetails) return row;
    return {
      ...row,
      before_data: null,
      after_data: null,
      metadata: {},
      ip_address: null,
      user_agent: null,
    };
  });

  return NextResponse.json({
    ok: true,
    data: sanitized,
    total: count ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
    summary: summary ?? null,
    canViewDetails,
    canExport:
      gate.actor.isSuperAdmin ||
      gate.actor.permissions.has("audit_logs.export"),
  });
}
