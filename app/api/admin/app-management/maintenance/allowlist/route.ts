import { NextResponse } from "next/server";

import {
  requireAdminPermission,
  safeErrorMessage,
} from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordChange,
  recordFailure,
} from "@/lib/admin-audit";
import {
  allowlistAuditSnapshot,
  normalizeMaintenanceMobileE164,
} from "@/lib/app-maintenance-admin";

const SELECT = `
  id, mobile_number, normalized_mobile_number, is_active, description,
  created_at, updated_at, created_by, updated_by
`;

export async function GET(request: Request) {
  const gate = await requireAdminPermission("app.view", {
    request,
    auditModule: "app",
  });
  if (!gate.ok) return gate.response;

  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    const activeOnly = url.searchParams.get("active") === "1";

    let query = gate.supabase
      .from("skg_app_maintenance_allowed_numbers")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(200);

    if (activeOnly) query = query.eq("is_active", true);
    if (q) {
      const norm = normalizeMaintenanceMobileE164(q);
      if (norm.ok) {
        query = query.eq("normalized_mobile_number", norm.e164);
      } else {
        query = query.ilike("mobile_number", `%${q.replace(/%/g, "")}%`);
      }
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to load allowlist."),
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, items: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load allowlist."),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const gate = await requireAdminPermission("app.manage", {
    request,
    auditModule: "app",
  });
  if (!gate.ok) return gate.response;

  const auditBase = {
    actor: gate.actor,
    module: "app",
    resourceType: "skg_app_maintenance_allowed_numbers",
    resourceId: "new",
    ...clientMetaFromRequest(request),
  };

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Invalid payload." },
        { status: 400 },
      );
    }
    const payload = body as Record<string, unknown>;
    const norm = normalizeMaintenanceMobileE164(payload.mobile_number);
    if (!norm.ok) {
      return NextResponse.json(
        { ok: false, error: norm.error },
        { status: 400 },
      );
    }
    const description =
      typeof payload.description === "string"
        ? payload.description.trim().slice(0, 300) || null
        : null;
    const isActive =
      payload.is_active === undefined ? true : payload.is_active === true;

    const { data, error } = await gate.supabase
      .from("skg_app_maintenance_allowed_numbers")
      .insert({
        mobile_number: norm.display,
        normalized_mobile_number: norm.e164,
        is_active: isActive,
        description,
        created_by: gate.actor.id,
        updated_by: gate.actor.id,
      })
      .select(SELECT)
      .maybeSingle();

    if (error) {
      const dup = /duplicate|unique/i.test(error.message);
      void recordFailure({
        ...auditBase,
        action: "app.maintenance.allowlist.create",
        description: "Failed to add maintenance allowlist number",
        reason: error.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: dup
            ? "This mobile number is already on the allowlist."
            : safeErrorMessage(error, "Failed to add number."),
        },
        { status: dup ? 409 : 500 },
      );
    }

    void recordChange({
      ...auditBase,
      resourceId: String(data?.id ?? ""),
      action: "app.maintenance.allowlist.create",
      description: "Added maintenance allowlist number",
      afterData: allowlistAuditSnapshot(
        data as Record<string, unknown> | null,
      ),
    });

    return NextResponse.json({ ok: true, item: data });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "app.maintenance.allowlist.create",
      description: "Failed to add maintenance allowlist number",
      reason: safeErrorMessage(error, "create_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to add number."),
      },
      { status: 500 },
    );
  }
}
