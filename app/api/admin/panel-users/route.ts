import { NextResponse } from "next/server";

import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";
import { writeAdminAuditLog, clientMetaFromRequest } from "@/lib/admin-audit";
import { hashAdminPassword } from "@/lib/admin-password";

export async function GET() {
  const gate = await requireAdminPermission("admins.view");
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase
    .from("admin_panel_users")
    .select(
      `
      id,
      username,
      display_name,
      is_active,
      is_super_admin,
      last_login_at,
      created_at,
      updated_at,
      admin_panel_user_roles!admin_panel_user_roles_user_id_fkey (
        role_id,
        admin_panel_roles!admin_panel_user_roles_role_id_fkey ( id, slug, name )
      )
    `,
    )
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(error, "Failed to load admins.") },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, data: data ?? [] });
}

type CreateBody = {
  username?: string;
  displayName?: string;
  password?: string;
  isSuperAdmin?: boolean;
  roleIds?: string[];
  isActive?: boolean;
};

export async function POST(request: Request) {
  const gate = await requireAdminPermission("admins.manage", {
    request,
    auditModule: "administration",
  });
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as CreateBody;
  const username = body.username?.trim() ?? "";
  const displayName = body.displayName?.trim() || username;
  const password = body.password ?? "";
  const isSuperAdmin = body.isSuperAdmin === true;
  const isActive = body.isActive !== false;
  const roleIds = Array.isArray(body.roleIds) ? body.roleIds : [];

  if (!username || password.length < 8) {
    return NextResponse.json(
      {
        ok: false,
        error: "Username and password (min 8 characters) are required.",
      },
      { status: 400 },
    );
  }

  if (isSuperAdmin && !gate.actor.isSuperAdmin) {
    return NextResponse.json(
      {
        ok: false,
        error: "Only a Super Admin can create another Super Admin.",
      },
      { status: 403 },
    );
  }

  const { data: created, error } = await gate.supabase
    .from("admin_panel_users")
    .insert({
      username,
      display_name: displayName,
      password_hash: hashAdminPassword(password),
      is_super_admin: isSuperAdmin,
      is_active: isActive,
      created_by: gate.actor.id,
    })
    .select("id, username, display_name, is_active, is_super_admin, created_at")
    .single();

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json(
        { ok: false, error: "An admin with this username already exists." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(error, "Failed to create admin.") },
      { status: 400 },
    );
  }

  if (roleIds.length > 0) {
    await gate.supabase.from("admin_panel_user_roles").insert(
      roleIds.map((roleId) => ({
        user_id: created.id,
        role_id: roleId,
        assigned_by: gate.actor.id,
      })),
    );
  } else if (isSuperAdmin) {
    const { data: superRole } = await gate.supabase
      .from("admin_panel_roles")
      .select("id")
      .eq("slug", "super_admin")
      .maybeSingle();
    if (superRole?.id) {
      await gate.supabase.from("admin_panel_user_roles").insert({
        user_id: created.id,
        role_id: superRole.id,
        assigned_by: gate.actor.id,
      });
    }
  }

  void writeAdminAuditLog({
    actor: gate.actor,
    action: "admin_user_created",
    module: "administration",
    description: `Created admin user "${username}"`,
    success: true,
    resourceType: "admin_panel_user",
    resourceId: created.id,
    afterData: {
      username,
      displayName,
      isSuperAdmin,
      isActive,
      roleIds,
    },
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true, data: created });
}
