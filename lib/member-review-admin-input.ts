import { isAdminUuid } from "@/lib/admin-uuid";

export type MemberReviewStatus = "published" | "hidden" | "removed";
export type MemberReviewReportStatus = "open" | "resolved" | "dismissed";
export type MemberReviewModerateAction = "hide" | "unhide" | "remove";

export function isMemberReviewUuid(value: unknown): value is string {
  return typeof value === "string" && isAdminUuid(value);
}

export function parseModerateAction(
  value: unknown,
): MemberReviewModerateAction | null {
  if (value === "hide" || value === "unhide" || value === "remove") {
    return value;
  }
  return null;
}

export function parseResolveReportStatus(
  value: unknown,
): Exclude<MemberReviewReportStatus, "open"> | null {
  if (value === "resolved" || value === "dismissed") return value;
  return null;
}

export function statusAfterModerate(
  action: MemberReviewModerateAction,
): MemberReviewStatus {
  if (action === "hide") return "hidden";
  if (action === "unhide") return "published";
  return "removed";
}
