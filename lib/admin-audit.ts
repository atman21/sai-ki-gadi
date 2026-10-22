import type { AdminActor } from "@/lib/admin-rbac";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type AuditEventInput = {
  actor: AdminActor | null;
  action: string;
  module: string;
  description: string;
  success?: boolean;
  resourceType?: string;
  resourceId?: string;
  changedFields?: string[];
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * Append-only audit write. Never throws to callers — failures are logged
 * server-side so business mutations are not blocked by audit outages.
 * For critical paths that require atomicity, call and check returned ok.
 */
export async function writeAdminAuditLog(
  input: AuditEventInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const { data, error } = await supabaseAdmin
      .from("admin_panel_audit_logs")
      .insert({
        actor_id: input.actor?.id ?? null,
        actor_username: input.actor?.username ?? null,
        actor_display_name: input.actor?.displayName ?? null,
        actor_is_super_admin: input.actor?.isSuperAdmin ?? null,
        action: input.action,
        module: input.module,
        resource_type: input.resourceType ?? null,
        resource_id: input.resourceId ?? null,
        description: input.description,
        success: input.success !== false,
        changed_fields: input.changedFields ?? [],
        before_data: input.beforeData ?? null,
        after_data: input.afterData ?? null,
        metadata: input.metadata ?? {},
        request_id: input.requestId ?? null,
        ip_address: input.ipAddress ?? null,
        user_agent: input.userAgent ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[admin-audit] insert failed:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id as string };
  } catch (err) {
    console.error("[admin-audit] unexpected error:", err);
    return { ok: false, error: "audit_write_failed" };
  }
}

export function clientMetaFromRequest(request: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  const forwarded = request.headers.get("x-forwarded-for");
  const ipAddress =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    undefined;
  const userAgent = request.headers.get("user-agent") || undefined;
  return { ipAddress, userAgent };
}
