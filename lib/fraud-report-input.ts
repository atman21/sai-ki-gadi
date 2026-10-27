/** Validates untrusted admin fraud-report POST bodies before service-role writes. */
export type FraudReportCreateInput = {
  from_user_id: string;
  to_user_id: string;
  reason: string;
  description: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON_LENGTH = 250;
const MAX_DESCRIPTION_LENGTH = 4000;

export function parseFraudReportCreateInput(input: unknown): FraudReportCreateInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const row = input as Record<string, unknown>;
  if (
    typeof row.from_user_id !== "string" ||
    typeof row.to_user_id !== "string" ||
    !UUID_RE.test(row.from_user_id) ||
    !UUID_RE.test(row.to_user_id) ||
    typeof row.reason !== "string"
  ) {
    return null;
  }

  const reason = row.reason.trim();
  if (!reason || reason.length > MAX_REASON_LENGTH) return null;

  if (
    row.description != null &&
    (typeof row.description !== "string" || row.description.length > MAX_DESCRIPTION_LENGTH)
  ) {
    return null;
  }

  const description =
    typeof row.description === "string" && row.description.trim()
      ? row.description.trim()
      : null;

  return {
    from_user_id: row.from_user_id,
    to_user_id: row.to_user_id,
    reason,
    description,
  };
}
