/**
 * App-wide Maintenance Mode (Admin helpers).
 * Source of truth: skg_app_maintenance_* (Mobile migration).
 * Distinct from skg_ai_settings.emergency_disabled.
 */

export const SKG_APP_MAINTENANCE_LOCALES = [
  "en",
  "hi",
  "gu",
  "mr",
  "kn",
] as const;
export type SkgAppMaintenanceLocale =
  (typeof SKG_APP_MAINTENANCE_LOCALES)[number];

export type MaintenanceTranslation = {
  title?: string;
  message?: string;
};

export type AppMaintenanceSettingsRow = {
  id: number;
  enabled: boolean;
  force_emergency: boolean;
  owner_bypass_enabled: boolean;
  logged_out_policy: "block" | "allow";
  title: string;
  message: string;
  translations: Record<string, MaintenanceTranslation>;
  image_url: string | null;
  support_contact: string | null;
  expected_return_at: string | null;
  start_at: string | null;
  end_at: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type AppMaintenanceAllowedNumberRow = {
  id: string;
  mobile_number: string;
  normalized_mobile_number: string;
  is_active: boolean;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
};

export type AppMaintenanceOwnerRow = {
  user_id: string;
  description: string | null;
  created_at: string | null;
  created_by: string | null;
  phone?: string | null;
};

/** Normalize to users.phone form: +91XXXXXXXXXX */
export function normalizeMaintenanceMobileE164(
  raw: unknown,
): { ok: true; e164: string; display: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "Mobile number is required." };
  }
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0") && digits.length === 11) {
    digits = digits.slice(1);
  }
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return {
      ok: false,
      error: "Enter a valid 10-digit Indian mobile number.",
    };
  }
  const e164 = `+91${digits}`;
  return { ok: true, e164, display: e164 };
}

export function isMaintenanceLocale(
  value: unknown,
): value is SkgAppMaintenanceLocale {
  return (
    typeof value === "string" &&
    (SKG_APP_MAINTENANCE_LOCALES as readonly string[]).includes(value)
  );
}

function parseOptionalIso(
  value: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined as unknown as null };
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, error: `${field} must be an ISO timestamp or null.` };
  }
  const d = Date.parse(value);
  if (Number.isNaN(d)) {
    return { ok: false, error: `${field} is not a valid date.` };
  }
  return { ok: true, value: new Date(d).toISOString() };
}

export function sanitizeMaintenanceSettingsUpdate(
  input: unknown,
  current: AppMaintenanceSettingsRow,
):
  | { ok: true; patch: Partial<AppMaintenanceSettingsRow> }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Settings payload must be an object." };
  }
  const body = input as Record<string, unknown>;
  const patch: Partial<AppMaintenanceSettingsRow> = {};

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return { ok: false, error: "enabled must be a boolean." };
    }
    patch.enabled = body.enabled;
  }
  if (body.force_emergency !== undefined) {
    if (typeof body.force_emergency !== "boolean") {
      return { ok: false, error: "force_emergency must be a boolean." };
    }
    patch.force_emergency = body.force_emergency;
  }
  if (body.owner_bypass_enabled !== undefined) {
    if (typeof body.owner_bypass_enabled !== "boolean") {
      return { ok: false, error: "owner_bypass_enabled must be a boolean." };
    }
    patch.owner_bypass_enabled = body.owner_bypass_enabled;
  }
  if (body.logged_out_policy !== undefined) {
    if (body.logged_out_policy !== "block" && body.logged_out_policy !== "allow") {
      return { ok: false, error: "logged_out_policy must be block or allow." };
    }
    patch.logged_out_policy = body.logged_out_policy;
  }
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return { ok: false, error: "title is required." };
    }
    if (body.title.trim().length > 200) {
      return { ok: false, error: "title must be at most 200 characters." };
    }
    patch.title = body.title.trim();
  }
  if (body.message !== undefined) {
    if (typeof body.message !== "string" || !body.message.trim()) {
      return { ok: false, error: "message is required." };
    }
    if (body.message.trim().length > 2000) {
      return { ok: false, error: "message must be at most 2000 characters." };
    }
    patch.message = body.message.trim();
  }
  if (body.image_url !== undefined) {
    if (body.image_url === null || body.image_url === "") {
      patch.image_url = null;
    } else if (typeof body.image_url !== "string" || body.image_url.length > 1000) {
      return { ok: false, error: "image_url is invalid." };
    } else {
      patch.image_url = body.image_url.trim();
    }
  }
  if (body.support_contact !== undefined) {
    if (body.support_contact === null || body.support_contact === "") {
      patch.support_contact = null;
    } else if (
      typeof body.support_contact !== "string" ||
      body.support_contact.length > 120
    ) {
      return { ok: false, error: "support_contact is invalid." };
    } else {
      patch.support_contact = body.support_contact.trim();
    }
  }
  if (body.translations !== undefined) {
    if (
      !body.translations ||
      typeof body.translations !== "object" ||
      Array.isArray(body.translations)
    ) {
      return { ok: false, error: "translations must be an object." };
    }
    const out: Record<string, MaintenanceTranslation> = {
      ...current.translations,
    };
    for (const [loc, val] of Object.entries(
      body.translations as Record<string, unknown>,
    )) {
      if (!isMaintenanceLocale(loc)) {
        return { ok: false, error: `Unsupported locale: ${loc}` };
      }
      if (!val || typeof val !== "object" || Array.isArray(val)) {
        return { ok: false, error: `Invalid translation for ${loc}.` };
      }
      const t = val as MaintenanceTranslation;
      const entry: MaintenanceTranslation = {};
      if (t.title !== undefined) {
        if (typeof t.title !== "string" || t.title.length > 200) {
          return { ok: false, error: `Invalid title for ${loc}.` };
        }
        entry.title = t.title.trim();
      }
      if (t.message !== undefined) {
        if (typeof t.message !== "string" || t.message.length > 2000) {
          return { ok: false, error: `Invalid message for ${loc}.` };
        }
        entry.message = t.message.trim();
      }
      out[loc] = { ...(out[loc] ?? {}), ...entry };
    }
    patch.translations = out;
  }

  for (const field of [
    "expected_return_at",
    "start_at",
    "end_at",
  ] as const) {
    if (body[field] !== undefined) {
      const parsed = parseOptionalIso(body[field], field);
      if (!parsed.ok) return parsed;
      // parseOptionalIso returns null for clear; undefined skip handled above
      (patch as Record<string, unknown>)[field] = parsed.value;
    }
  }

  const nextStart =
    patch.start_at !== undefined ? patch.start_at : current.start_at;
  const nextEnd = patch.end_at !== undefined ? patch.end_at : current.end_at;
  if (nextStart && nextEnd && Date.parse(nextStart) >= Date.parse(nextEnd)) {
    return { ok: false, error: "start_at must be before end_at." };
  }

  return { ok: true, patch };
}

export function mapMaintenanceSettingsRow(
  raw: Record<string, unknown> | null,
): AppMaintenanceSettingsRow | null {
  if (!raw) return null;
  const translationsRaw = raw.translations;
  const translations: Record<string, MaintenanceTranslation> =
    translationsRaw &&
    typeof translationsRaw === "object" &&
    !Array.isArray(translationsRaw)
      ? (translationsRaw as Record<string, MaintenanceTranslation>)
      : {};

  return {
    id: Number(raw.id ?? 1),
    enabled: raw.enabled === true,
    force_emergency: raw.force_emergency === true,
    owner_bypass_enabled: raw.owner_bypass_enabled !== false,
    logged_out_policy:
      raw.logged_out_policy === "allow" ? "allow" : "block",
    title: String(raw.title ?? "We will be back soon"),
    message: String(
      raw.message ??
        "Sai Ki Gadi is undergoing scheduled maintenance. Please try again shortly.",
    ),
    translations,
    image_url: (raw.image_url as string | null) ?? null,
    support_contact: (raw.support_contact as string | null) ?? null,
    expected_return_at: (raw.expected_return_at as string | null) ?? null,
    start_at: (raw.start_at as string | null) ?? null,
    end_at: (raw.end_at as string | null) ?? null,
    updated_at: (raw.updated_at as string | null) ?? null,
    updated_by: (raw.updated_by as string | null) ?? null,
  };
}

/** Effective active flag (mirrors SQL skg_app_maintenance_is_active). */
export function computeMaintenanceActive(
  row: AppMaintenanceSettingsRow,
  asOfMs = Date.now(),
): boolean {
  if (row.force_emergency) return true;
  if (!row.enabled) return false;
  if (row.start_at && Date.parse(row.start_at) > asOfMs) return false;
  if (row.end_at && Date.parse(row.end_at) <= asOfMs) return false;
  return true;
}

export function maintenanceAuditSnapshot(
  row: Partial<AppMaintenanceSettingsRow> | null | undefined,
): Record<string, unknown> {
  if (!row) return {};
  return {
    enabled: row.enabled ?? null,
    force_emergency: row.force_emergency ?? null,
    owner_bypass_enabled: row.owner_bypass_enabled ?? null,
    logged_out_policy: row.logged_out_policy ?? null,
    title: row.title ?? null,
    message: row.message ? "[redacted_length:" + row.message.length + "]" : null,
    has_translations: Boolean(
      row.translations && Object.keys(row.translations).length,
    ),
    image_url: row.image_url ?? null,
    support_contact: row.support_contact ?? null,
    expected_return_at: row.expected_return_at ?? null,
    start_at: row.start_at ?? null,
    end_at: row.end_at ?? null,
  };
}

export function allowlistAuditSnapshot(
  row: Partial<AppMaintenanceAllowedNumberRow> | null | undefined,
): Record<string, unknown> {
  if (!row) return {};
  return {
    id: row.id ?? null,
    normalized_mobile_number: row.normalized_mobile_number ?? null,
    is_active: row.is_active ?? null,
    has_description: Boolean(row.description),
  };
}
