import { NextResponse } from "next/server";

import { requireAdminApi, requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";
import { writeAdminAuditLog, clientMetaFromRequest } from "@/lib/admin-audit";
import { isAdminPermission } from "@/lib/admin-permissions";
import { actorHasPermission } from "@/lib/admin-rbac";

export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const canView =
    gate.actor.isSuperAdmin ||
    actorHasPermission(gate.actor, "roles.manage") ||
    actorHasPermission(gate.actor, "admins.view") ||
    actorHasPermission(gate.actor, "permissions.assign");

  if (!canView) {
    return NextResponse.json(
      { ok: false, error: "Forbidden — insufficient permissions." },
      { status: 403 },
    );
  }

  const { data, error } = await gate.supabase
    .from("admin_panel_roles")
    .select(
      `
      id, slug, name, description, is_system, created_at,
      admin_panel_role_permissions ( permission_key )
    `,
    )
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(error, "Failed to load roles.") },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, data: data ?? [] });
}

type CreateBody = {
  slug?: string;
  name?: string;
  description?: string;
  permissionKeys?: string[];
};

export async function POST(request: Request) {
  const gate = await requireAdminPermission("roles.manage", {
    request,
    auditModule: "administration",
  });
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as CreateBody;
  const slug = (body.slug ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  const name = (body.name ?? "").trim();
  const description = body.description?.trim() || null;
  const permissionKeys = (body.permissionKeys ?? []).filter(isAdminPermission);

  if (!slug || !name) {
    return NextResponse.json(
      { ok: false, error: "Slug and name are required." },
      { status: 400 },
    );
  }

  const { data: role, error } = await gate.supabase
    .from("admin_panel_roles")
    .insert({ slug, name, description, is_system: false })
    .select("id, slug, name")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(error, "Failed to create role.") },
      { status: 400 },
    );
  }

  if (permissionKeys.length > 0) {
    await gate.supabase.from("admin_panel_role_permissions").insert(
      permissionKeys.map((permission_key) => ({
        role_id: role.id,
        permission_key,
      })),
    );
  }

  void writeAdminAuditLog({
    actor: gate.actor,
    action: "role_created",
    module: "administration",
    description: `Created role "${name}"`,
    resourceType: "admin_panel_role",
    resourceId: role.id,
    afterData: { slug, name, permissionKeys },
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true, data: role });
}
