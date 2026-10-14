/**
 * Wallet idempotency keys must be scoped to a single user so a reused client
 * key cannot collide with another user's ledger entry.
 *
 * Stored/RPC form: `admin-wallet:<userId>:<opaque>`
 */

const PREFIX = "admin-wallet:";

export function buildWalletIdempotencyKey(
  userId: string,
  opaque?: string,
): string {
  const id = userId.trim();
  const suffix =
    opaque?.trim() ||
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return `${PREFIX}${id}:${suffix}`;
}

/**
 * Normalize any client-supplied key into a user-scoped key.
 * Strips a mistaken prefix for another user and rebinds to `userId`.
 */
export function scopeWalletIdempotencyKey(
  userId: string,
  clientKey: string,
): string | null {
  const id = userId.trim();
  const raw = clientKey.trim();
  if (!id || !raw || raw.length > 200) return null;

  const expectedPrefix = `${PREFIX}${id}:`;
  if (raw.startsWith(expectedPrefix) && raw.length > expectedPrefix.length) {
    return raw.slice(0, 200);
  }

  // Client sent unscoped or foreign-scoped key — rebind to this user only.
  const opaque = raw.startsWith(PREFIX)
    ? raw.slice(PREFIX.length).replace(/^[^:]+:/, "") || raw
    : raw;
  const scoped = buildWalletIdempotencyKey(id, opaque);
  return scoped.length <= 200 ? scoped : scoped.slice(0, 200);
}
