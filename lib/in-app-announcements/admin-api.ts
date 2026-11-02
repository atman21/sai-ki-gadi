/**
 * Re-export shared admin API helpers so announcement routes keep working.
 * Prefer importing from `@/lib/admin-api` in new code.
 */
export {
  requireAdminApi,
  requireAdminPermission,
  safeErrorMessage,
} from "@/lib/admin-api";
