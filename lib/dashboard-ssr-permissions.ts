import type { AdminPermission } from "@/lib/admin-permissions";
import type { AdminActor } from "@/lib/admin-rbac";
import { actorHasPermission } from "@/lib/admin-rbac";

/**
 * Shared SSR permission predicate for dashboard dataset loading.
 * Fail-closed: missing/inactive actors never receive sensitive props.
 */
export function actorCanAccess(
  actor: AdminActor | null | undefined,
  permission: AdminPermission,
): boolean {
  return Boolean(
    actor &&
      actor.isActive &&
      actorHasPermission(actor, permission),
  );
}
