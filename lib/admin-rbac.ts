import { timingSafeEqual } from "node:crypto";

import type { AdminSessionPayload } from "@/lib/admin-auth";
import { getAdminPassword, getAdminUsername } from "@/lib/admin-auth";
import {
  ADMIN_PERMISSIONS,
  type AdminPermission,
  isAdminPermission,
} from "@/lib/admin-permissions";
import { hashAdminPassword, verifyAdminPassword } from "@/lib/admin-password";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type AdminActor = {
  id: string | null;
  username: string;
  displayName: string;
  isSuperAdmin: boolean;
  isActive: boolean;
  /** Effective permission keys after role grants + user overrides. */
  permissions: Set<AdminPermission>;
  /** True when authenticated via env bootstrap without a DB row yet. */
  isEnvBootstrap: boolean;
};

type DbAdminUser = {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  is_active: boolean;
  is_super_admin: boolean;
};

function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // Still run a compare to reduce timing signal on length-only paths.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function actorHasPermission(
  actor: AdminActor,
  permission: AdminPermission,
): boolean {
  if (actor.isSuperAdmin) return true;
  return actor.permissions.has(permission);
}

export function allPermissionsSet(): Set<AdminPermission> {
  return new Set(ADMIN_PERMISSIONS);
}

/**
 * Evaluate effective permissions:
 * 1. Super Admin → all
 * 2. Union of role permissions
 * 3. Apply user overrides: deny removes, grant adds
 */
export async function loadEffectivePermissions(
  userId: string,
  isSuperAdmin: boolean,
): Promise<Set<AdminPermission>> {
  if (isSuperAdmin) return allPermissionsSet();

  const granted = new Set<AdminPermission>();

  const { data: roleRows } = await supabaseAdmin
    .from("admin_panel_user_roles")
    .select("role_id")
    .eq("user_id", userId);

  const roleIds = (roleRows ?? []).map((r) => r.role_id as string);
  if (roleIds.length > 0) {
    const { data: rolePerms } = await supabaseAdmin
      .from("admin_panel_role_permissions")
      .select("permission_key")
      .in("role_id", roleIds);
    for (const row of rolePerms ?? []) {
      const key = String(row.permission_key);
      if (isAdminPermission(key)) granted.add(key);
    }
  }

  const { data: overrides } = await supabaseAdmin
    .from("admin_panel_user_permissions")
    .select("permission_key, effect")
    .eq("user_id", userId);

  for (const row of overrides ?? []) {
    const key = String(row.permission_key);
    if (!isAdminPermission(key)) continue;
    if (row.effect === "deny") granted.delete(key);
    else if (row.effect === "grant") granted.add(key);
  }

  return granted;
}

export async function resolveActorFromSession(
  session: AdminSessionPayload,
): Promise<AdminActor | null> {
  // Prefer DB identity when session has adminId
  if (session.adminId) {
    const { data, error } = await supabaseAdmin
      .from("admin_panel_users")
      .select(
        "id, username, display_name, is_active, is_super_admin, password_hash",
      )
      .eq("id", session.adminId)
      .maybeSingle();

    if (error || !data) return null;
    if (!data.is_active) return null;

    const permissions = await loadEffectivePermissions(
      data.id,
      Boolean(data.is_super_admin),
    );

    return {
      id: data.id,
      username: data.username,
      displayName: data.display_name,
      isSuperAdmin: Boolean(data.is_super_admin),
      isActive: true,
      permissions,
      isEnvBootstrap: false,
    };
  }

  // Legacy / env session without adminId → treat as Super Admin bootstrap
  // only if username matches configured env username.
  const envUser = getAdminUsername();
  if (safeEqualString(session.username, envUser) || session.isSuperAdmin) {
    return {
      id: null,
      username: envUser,
      displayName: "Super Admin",
      isSuperAdmin: true,
      isActive: true,
      permissions: allPermissionsSet(),
      isEnvBootstrap: true,
    };
  }

  return null;
}

/**
 * Authenticate login against DB users first, then env bootstrap credentials.
 * Ensures a Super Admin DB row exists when env credentials succeed (seed).
 */
export async function authenticateAdminLogin(
  username: string,
  password: string,
): Promise<
  | { ok: true; actor: AdminActor; sessionFields: AdminSessionPayload }
  | { ok: false; error: string }
> {
  const trimmed = username.trim();
  if (!trimmed || !password) {
    return { ok: false, error: "Invalid username or password." };
  }

  // 1) DB user
  const { data: dbUser, error: dbError } = await supabaseAdmin
    .from("admin_panel_users")
    .select(
      "id, username, display_name, password_hash, is_active, is_super_admin",
    )
    .ilike("username", trimmed)
    .maybeSingle();

  if (!dbError && dbUser) {
    const row = dbUser as DbAdminUser;
    if (!row.is_active) {
      return { ok: false, error: "This admin account is disabled." };
    }
    if (!verifyAdminPassword(password, row.password_hash)) {
      return { ok: false, error: "Invalid username or password." };
    }

    await supabaseAdmin
      .from("admin_panel_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", row.id);

    const permissions = await loadEffectivePermissions(
      row.id,
      Boolean(row.is_super_admin),
    );

    const actor: AdminActor = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      isSuperAdmin: Boolean(row.is_super_admin),
      isActive: true,
      permissions,
      isEnvBootstrap: false,
    };

    return {
      ok: true,
      actor,
      sessionFields: {
        role: "admin",
        exp: 0,
        adminId: row.id,
        username: row.username,
        displayName: row.display_name,
        isSuperAdmin: Boolean(row.is_super_admin),
      },
    };
  }

  // 2) Env bootstrap Super Admin. Disabled when ADMIN_PASSWORD is unset
  // or still the historical development password.
  const envUser = getAdminUsername();
  const envPass = getAdminPassword();
  if (
    envPass !== null &&
    safeEqualString(trimmed, envUser) &&
    safeEqualString(password, envPass)
  ) {
    const seeded = await ensureEnvSuperAdminSeeded(envUser, password);
    if (seeded) {
      const permissions = await loadEffectivePermissions(seeded.id, true);
      return {
        ok: true,
        actor: {
          id: seeded.id,
          username: seeded.username,
          displayName: seeded.display_name,
          isSuperAdmin: true,
          isActive: true,
          permissions,
          isEnvBootstrap: false,
        },
        sessionFields: {
          role: "admin",
          exp: 0,
          adminId: seeded.id,
          username: seeded.username,
          displayName: seeded.display_name,
          isSuperAdmin: true,
        },
      };
    }

    // Tables not migrated yet — allow env login as ephemeral Super Admin
    return {
      ok: true,
      actor: {
        id: null,
        username: envUser,
        displayName: "Super Admin",
        isSuperAdmin: true,
        isActive: true,
        permissions: allPermissionsSet(),
        isEnvBootstrap: true,
      },
      sessionFields: {
        role: "admin",
        exp: 0,
        username: envUser,
        displayName: "Super Admin",
        isSuperAdmin: true,
      },
    };
  }

  return { ok: false, error: "Invalid username or password." };
}

async function ensureEnvSuperAdminSeeded(
  username: string,
  password: string,
): Promise<DbAdminUser | null> {
  try {
    const { data: existing } = await supabaseAdmin
      .from("admin_panel_users")
      .select(
        "id, username, display_name, password_hash, is_active, is_super_admin",
      )
      .ilike("username", username)
      .maybeSingle();

    if (existing) {
      // Keep password in sync with env if they still use env login path
      if (!verifyAdminPassword(password, existing.password_hash)) {
        await supabaseAdmin
          .from("admin_panel_users")
          .update({
            password_hash: hashAdminPassword(password),
            is_super_admin: true,
            is_active: true,
            last_login_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabaseAdmin
          .from("admin_panel_users")
          .update({
            is_super_admin: true,
            is_active: true,
            last_login_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }
      return {
        ...(existing as DbAdminUser),
        is_super_admin: true,
        is_active: true,
      };
    }

    const { data: created, error } = await supabaseAdmin
      .from("admin_panel_users")
      .insert({
        username,
        display_name: "Super Admin",
        password_hash: hashAdminPassword(password),
        is_super_admin: true,
        is_active: true,
        last_login_at: new Date().toISOString(),
      })
      .select(
        "id, username, display_name, password_hash, is_active, is_super_admin",
      )
      .single();

    if (error || !created) return null;

    const { data: superRole } = await supabaseAdmin
      .from("admin_panel_roles")
      .select("id")
      .eq("slug", "super_admin")
      .maybeSingle();

    if (superRole?.id) {
      await supabaseAdmin.from("admin_panel_user_roles").upsert(
        {
          user_id: created.id,
          role_id: superRole.id,
          assigned_by: created.id,
        },
        { onConflict: "user_id,role_id" },
      );
    }

    return created as DbAdminUser;
  } catch {
    return null;
  }
}

export async function countActiveSuperAdmins(): Promise<number> {
  const { count } = await supabaseAdmin
    .from("admin_panel_users")
    .select("id", { count: "exact", head: true })
    .eq("is_super_admin", true)
    .eq("is_active", true);
  return count ?? 0;
}
