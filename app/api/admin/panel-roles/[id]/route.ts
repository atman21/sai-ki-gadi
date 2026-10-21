import { NextResponse } from "next/server";

import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";
import { writeAdminAuditLog, clientMetaFromRequest } from "@/lib/admin-audit";
import { isAdminPermission } from "@/lib/admin-permissions";

type Context = { params: Promise<{ id: string }> };

type PatchBody = {
  name?: string;
  description?: string | null;
  permissionKeys?: string[];
};

export async function PATCH(request: Request, context: Context) {
  const gate = await requireAdminPermission("roles.manage", {
    request,
    auditModule: "administration",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as PatchBody;

  const { data: existing } = await gate.supabase
    .from("admin_panel_roles")
    .select("id, slug, name, description, is_system")
    .eq("id", id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Role not found." },
      { status: 404 },
    );
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }
  if (body.description !== undefined) {
    updates.description =
      body.description == null ? null : String(body.description).trim();
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await gate.supabase
      .from("admin_panel_roles")
      .update(updates)
      .eq("id", id);
    if (error) {
      return NextResponse.json(
        { ok: false, error: safeErrorMessage(error, "Failed to update role.") },
        { status: 400 },
      );
    }
  }

  if (Array.isArray(body.permissionKeys)) {
    // Protect super_admin system role from being emptied accidentally
    if (existing.slug === "super_admin") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Super Admin system role permissions are fixed and cannot be edited.",
        },
        { status: 400 },
      );
    }

    const keys = body.permissionKeys.filter(isAdminPermission);
    await gate.supabase
      .from("admin_panel_role_permissions")
      .delete()
      .eq("role_id", id);
    if (keys.length > 0) {
      await gate.supabase.from("admin_panel_role_permissions").insert(
        keys.map((permission_key) => ({
          role_id: id,
          permission_key,
        })),
      );
    }
  }

  void writeAdminAuditLog({
    actor: gate.actor,
    action: "role_updated",
    module: "administration",
    description: `Updated role "${existing.name}"`,
    resourceType: "admin_panel_role",
    resourceId: id,
    beforeData: {
      name: existing.name,
      description: existing.description,
    },
    afterData: {
      ...updates,
      permissionKeys: body.permissionKeys,
    },
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true });
}
