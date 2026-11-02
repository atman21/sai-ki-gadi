/** Strict UUID (8-4-4-4-12 hex) for admin route path/body IDs. */
const ADMIN_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAdminUuid(value: string): boolean {
  return ADMIN_UUID_RE.test(value);
}
