import type { AdminActor } from "@/lib/admin-rbac";
import { supabaseAdmin } from "@/lib/supabase-admin";

export {
  AUDIT_ACTION_LABELS,
  auditActionLabel,
} from "@/lib/admin-audit-labels";

/** Explicit system/service actor for scheduled jobs and automated workers. */
export const SYSTEM_AUDIT_ACTOR: AdminActor = {
  id: null,
  username: "system",
  displayName: "System / Service",
  isSuperAdmin: false,
  isActive: true,
  permissions: new Set(),
  isEnvBootstrap: false,
};

export type AuditOutcome =
  | "success"
  | "failure"
  | "partial"
  | "pending"
  | "rejected";

export type AuditEventInput = {
  actor: AdminActor | null;
  action: string;
  module: string;
  description: string;
  success?: boolean;
  outcome?: AuditOutcome;
  reason?: string | null;
  resourceType?: string;
  resourceId?: string;
  entityLabel?: string | null;
  relatedUserId?: string | null;
  changedFields?: string[];
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  requestId?: string;
  httpMethod?: string;
  routeName?: string;
  ipAddress?: string;
  userAgent?: string;
};

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|otp|authorization|api[_-]?key|service[_-]?role|session|cookie|card|cvv|pan|aadhaar|aadhar)/i;

export function createAuditRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Deep-ish redact of secrets from JSON-safe objects before persistence. */
export function redactSensitiveData(
  value: unknown,
  depth = 0,
): unknown {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, depth + 1));
  }
  if (typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = redactSensitiveData(nested, depth + 1);
  }
  return out;
}

export function clientMetaFromRequest(request: Request): {
  ipAddress?: string;
  userAgent?: string;
  httpMethod?: string;
  requestId?: string;
} {
  const forwarded = request.headers.get("x-forwarded-for");
  const ipAddress =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    undefined;
  const userAgent = request.headers.get("user-agent") || undefined;
  const requestId =
    request.headers.get("x-request-id") ||
    request.headers.get("x-correlation-id") ||
    createAuditRequestId();
  return {
    ipAddress,
    userAgent,
    httpMethod: request.method,
    requestId,
  };
}

function actorRoleSnapshot(actor: AdminActor | null): string | null {
  if (!actor) return "system";
  if (actor.isSuperAdmin) return "super_admin";
  if (actor.isEnvBootstrap) return "env_bootstrap";
  return "admin";
}

function resolveOutcome(input: AuditEventInput): AuditOutcome {
  if (input.outcome) return input.outcome;
  return input.success === false ? "failure" : "success";
}

/**
 * Append-only audit write. Never throws to callers — failures are logged
 * server-side so business mutations are not blocked by audit outages.
 * For critical paths that require atomicity, call and check returned ok.
 */
export async function writeAdminAuditLog(
  input: AuditEventInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const outcome = resolveOutcome(input);
    const success = outcome === "success" || outcome === "partial"
      ? input.success !== false
      : false;
    const metadata = {
      ...(typeof input.metadata === "object" && input.metadata
        ? (redactSensitiveData(input.metadata) as Record<string, unknown>)
        : {}),
      outcome,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.entityLabel ? { entity_label: input.entityLabel } : {}),
      ...(input.relatedUserId ? { related_user_id: input.relatedUserId } : {}),
      ...(input.httpMethod ? { http_method: input.httpMethod } : {}),
      ...(input.routeName ? { route_name: input.routeName } : {}),
      actor_role: actorRoleSnapshot(input.actor),
    };

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
        success,
        outcome,
        reason: input.reason ?? null,
        entity_label: input.entityLabel ?? null,
        actor_role: actorRoleSnapshot(input.actor),
        related_user_id: input.relatedUserId ?? null,
        http_method: input.httpMethod ?? null,
        route_name: input.routeName ?? null,
        changed_fields: input.changedFields ?? [],
        before_data: input.beforeData
          ? redactSensitiveData(input.beforeData)
          : null,
        after_data: input.afterData
          ? redactSensitiveData(input.afterData)
          : null,
        metadata,
        request_id: input.requestId ?? null,
        ip_address: input.ipAddress ?? null,
        user_agent: input.userAgent ?? null,
      })
      .select("id")
      .single();

    if (error) {
      // Backward-compatible fallback if migration 066 columns are not applied yet.
      if (/outcome|entity_label|actor_role|related_user_id|http_method|route_name|reason/i.test(error.message)) {
        const legacy = await supabaseAdmin
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
            success,
            changed_fields: input.changedFields ?? [],
            before_data: input.beforeData
              ? redactSensitiveData(input.beforeData)
              : null,
            after_data: input.afterData
              ? redactSensitiveData(input.afterData)
              : null,
            metadata,
            request_id: input.requestId ?? null,
            ip_address: input.ipAddress ?? null,
            user_agent: input.userAgent ?? null,
          })
          .select("id")
          .single();
        if (legacy.error) {
          console.error("[admin-audit] insert failed:", legacy.error.message);
          return { ok: false, error: legacy.error.message };
        }
        return { ok: true, id: legacy.data?.id as string };
      }
      console.error("[admin-audit] insert failed:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id as string };
  } catch (err) {
    console.error("[admin-audit] unexpected error:", err);
    return { ok: false, error: "audit_write_failed" };
  }
}

export async function recordSuccess(
  input: Omit<AuditEventInput, "success" | "outcome">,
) {
  return writeAdminAuditLog({ ...input, success: true, outcome: "success" });
}

export async function recordFailure(
  input: Omit<AuditEventInput, "success" | "outcome"> & {
    outcome?: Exclude<AuditOutcome, "success">;
  },
) {
  return writeAdminAuditLog({
    ...input,
    success: false,
    outcome: input.outcome ?? "failure",
  });
}

export async function recordActivity(input: AuditEventInput) {
  return writeAdminAuditLog(input);
}

export async function recordChange(
  input: Omit<AuditEventInput, "success" | "outcome"> & {
    changedFields: string[];
    beforeData?: Record<string, unknown> | null;
    afterData?: Record<string, unknown> | null;
  },
) {
  return writeAdminAuditLog({
    ...input,
    success: true,
    outcome: "success",
  });
}

/** Diff helper for field-level change summaries. */
export function diffChangedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  keys?: string[],
): string[] {
  const fieldKeys =
    keys ??
    Array.from(
      new Set([
        ...Object.keys(before ?? {}),
        ...Object.keys(after ?? {}),
      ]),
    );
  return fieldKeys.filter((key) => {
    const left = JSON.stringify(before?.[key] ?? null);
    const right = JSON.stringify(after?.[key] ?? null);
    return left !== right;
  });
}
