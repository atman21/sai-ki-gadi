import type { AdminActor } from "@/lib/admin-rbac";
import { actorHasPermission } from "@/lib/admin-rbac";

/** SSR gate for member_reviews / member_review_reports dashboard loading. */
export function actorCanViewMemberReviews(
  actor: AdminActor | null | undefined,
): boolean {
  return Boolean(
    actor && actor.isActive && actorHasPermission(actor, "reviews.view"),
  );
}
