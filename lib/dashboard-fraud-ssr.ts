import type { AdminActor } from "@/lib/admin-rbac";
import { actorHasPermission } from "@/lib/admin-rbac";

/**
 * Server-side gate for dashboard SSR fraud_reports loading.
 * UI tab hiding alone is insufficient — props must not include fraud rows
 * unless the actor has fraud.view.
 */
export function actorCanViewFraudReports(
  actor: AdminActor | null | undefined,
): boolean {
  return Boolean(
    actor &&
      actor.isActive &&
      actorHasPermission(actor, "fraud.view"),
  );
}
