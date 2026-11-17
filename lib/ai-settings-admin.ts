/**
 * SKG AI Settings Admin helpers (Phase 2E).
 *
 * Source of truth: public.skg_ai_settings (Mobile T29 singleton id=1).
 * Model allowlist mirrors Mobile Edge `_shared/skg-ai-live-token.ts`
 * (do not invent models; Edge rejects unknown ids at mint).
 *
 * Prompt/scope/fallback copy lives in skg_ai_instructions (Phase 2D) —
 * Settings must not become a second source of truth for those fields.
 */

export const SKG_AI_ALLOWED_LIVE_MODELS = ["gemini-3.8-live"] as const;
export type SkgAiAllowedLiveModel =
  (typeof SKG_AI_ALLOWED_LIVE_MODELS)[number];

export const SKG_AI_SETTINGS_LOCALES = ["en", "hi", "gu"] as const;
export type SkgAiSettingsLocale = (typeof SKG_AI_SETTINGS_LOCALES)[number];

/** DB CHECK ceilings from T29 migration — do not exceed. */
export const SKG_AI_SETTINGS_BOUNDS = {
  weekly_allowance_seconds: { min: 1, max: 600 },
  max_session_seconds: { min: 1, max: 120 },
  lease_seconds: { min: 15, max: 30 },
} as const;

export type AiSettingsRow = {
  id: number;
  help_center_enabled: boolean;
  voice_enabled: boolean;
  voice_connectivity_verified_at: string | null;
  weekly_allowance_seconds: number;
  max_session_seconds: number;
  lease_seconds: number;
  gemini_model_id: string;
  supported_locales: string[];
  session_resumption_enabled: boolean;
  emergency_disabled: boolean;
  emergency_reason: string | null;
  emergency_disabled_at: string | null;
  emergency_disabled_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type AiSettingsUpdateInput = {
  help_center_enabled?: boolean;
  voice_enabled?: boolean;
  weekly_allowance_seconds?: number;
  max_session_seconds?: number;
  lease_seconds?: number;
  gemini_model_id?: string;
  supported_locales?: string[];
  /** Treated as preferred default language; stored as first of supported_locales. */
  default_locale?: string;
  session_resumption_enabled?: boolean;
  /** Explicit Admin stamp — never invent from client clocks alone without this flag. */
  mark_voice_connectivity_verified?: boolean;
};

export function isAllowedLiveModel(
  value: unknown,
): value is SkgAiAllowedLiveModel {
  return (
    typeof value === "string" &&
    (SKG_AI_ALLOWED_LIVE_MODELS as readonly string[]).includes(value)
  );
}

export function normalizeModelId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^models\//, "");
}

export function isSettingsLocale(
  value: unknown,
): value is SkgAiSettingsLocale {
  return (
    typeof value === "string" &&
    (SKG_AI_SETTINGS_LOCALES as readonly string[]).includes(value)
  );
}

export function parseSupportedLocales(
  value: unknown,
): { ok: true; locales: SkgAiSettingsLocale[] } | { ok: false; error: string } {
  if (value == null) {
    return { ok: true, locales: [...SKG_AI_SETTINGS_LOCALES] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, error: "supported_locales must be an array." };
  }
  const out: SkgAiSettingsLocale[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isSettingsLocale(item)) {
      return {
        ok: false,
        error: `Unsupported locale: ${String(item)}. Allowed: en, hi, gu.`,
      };
    }
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  if (out.length === 0) {
    return { ok: false, error: "Select at least one supported language." };
  }
  return { ok: true, locales: out };
}

function parseBoundedInt(
  value: unknown,
  field: keyof typeof SKG_AI_SETTINGS_BOUNDS,
): { ok: true; value: number } | { ok: false; error: string } {
  const bounds = SKG_AI_SETTINGS_BOUNDS[field];
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) {
    return { ok: false, error: `${field} must be an integer.` };
  }
  if (n < bounds.min || n > bounds.max) {
    return {
      ok: false,
      error: `${field} must be between ${bounds.min} and ${bounds.max}.`,
    };
  }
  return { ok: true, value: n };
}

/**
 * Validate a partial settings update. Does not apply emergency_* fields —
 * those use dedicated emergency endpoints that call the Mobile RPC.
 */
export function sanitizeAiSettingsUpdate(
  input: unknown,
  current: AiSettingsRow,
):
  | { ok: true; patch: Partial<AiSettingsRow>; markConnectivity: boolean }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Settings payload must be an object." };
  }
  const body = input as AiSettingsUpdateInput;
  const patch: Partial<AiSettingsRow> = {};
  let markConnectivity = body.mark_voice_connectivity_verified === true;

  if (body.help_center_enabled !== undefined) {
    if (typeof body.help_center_enabled !== "boolean") {
      return { ok: false, error: "help_center_enabled must be a boolean." };
    }
    patch.help_center_enabled = body.help_center_enabled;
  }

  if (body.voice_enabled !== undefined) {
    if (typeof body.voice_enabled !== "boolean") {
      return { ok: false, error: "voice_enabled must be a boolean." };
    }
    patch.voice_enabled = body.voice_enabled;
  }

  if (body.session_resumption_enabled !== undefined) {
    if (typeof body.session_resumption_enabled !== "boolean") {
      return {
        ok: false,
        error: "session_resumption_enabled must be a boolean.",
      };
    }
    patch.session_resumption_enabled = body.session_resumption_enabled;
  }

  if (body.gemini_model_id !== undefined) {
    const modelId = normalizeModelId(body.gemini_model_id);
    if (!isAllowedLiveModel(modelId)) {
      return {
        ok: false,
        error: `gemini_model_id must be one of: ${SKG_AI_ALLOWED_LIVE_MODELS.join(", ")}.`,
      };
    }
    patch.gemini_model_id = modelId;
  }

  if (body.weekly_allowance_seconds !== undefined) {
    const parsed = parseBoundedInt(
      body.weekly_allowance_seconds,
      "weekly_allowance_seconds",
    );
    if (!parsed.ok) return parsed;
    patch.weekly_allowance_seconds = parsed.value;
  }

  if (body.max_session_seconds !== undefined) {
    const parsed = parseBoundedInt(
      body.max_session_seconds,
      "max_session_seconds",
    );
    if (!parsed.ok) return parsed;
    patch.max_session_seconds = parsed.value;
  }

  if (body.lease_seconds !== undefined) {
    const parsed = parseBoundedInt(body.lease_seconds, "lease_seconds");
    if (!parsed.ok) return parsed;
    patch.lease_seconds = parsed.value;
  }

  let locales = current.supported_locales.filter(isSettingsLocale);
  if (locales.length === 0) locales = [...SKG_AI_SETTINGS_LOCALES];

  if (body.supported_locales !== undefined) {
    const parsed = parseSupportedLocales(body.supported_locales);
    if (!parsed.ok) return parsed;
    locales = parsed.locales;
  }

  if (body.default_locale !== undefined) {
    if (!isSettingsLocale(body.default_locale)) {
      return {
        ok: false,
        error: "default_locale must be one of: en, hi, gu.",
      };
    }
    if (!locales.includes(body.default_locale)) {
      return {
        ok: false,
        error: "default_locale must be included in supported_locales.",
      };
    }
    locales = [
      body.default_locale,
      ...locales.filter((l) => l !== body.default_locale),
    ];
  }

  if (
    body.supported_locales !== undefined ||
    body.default_locale !== undefined
  ) {
    patch.supported_locales = locales;
  }

  const nextVoice =
    patch.voice_enabled !== undefined
      ? patch.voice_enabled
      : current.voice_enabled;
  const nextConnectivity =
    markConnectivity && nextVoice
      ? "pending_stamp"
      : current.voice_connectivity_verified_at;

  if (nextVoice === true) {
    const hasStamp =
      markConnectivity ||
      (typeof nextConnectivity === "string" && nextConnectivity.length > 0) ||
      Boolean(current.voice_connectivity_verified_at);
    if (!hasStamp) {
      return {
        ok: false,
        error:
          "Cannot enable Voice AI until connectivity is verified (voice_connectivity_verified_at). Mark connectivity verified first.",
      };
    }
  }

  // Enabling voice with markConnectivity is OK; disabling clears nothing automatically.
  if (!nextVoice) {
    // Connectivity stamp may remain for re-enable without re-verify.
    markConnectivity = false;
  }

  return { ok: true, patch, markConnectivity };
}

export function mapSettingsRow(raw: Record<string, unknown> | null): AiSettingsRow | null {
  if (!raw) return null;
  const localesRaw = raw.supported_locales;
  const locales = Array.isArray(localesRaw)
    ? localesRaw.map((v) => String(v))
    : [...SKG_AI_SETTINGS_LOCALES];

  return {
    id: Number(raw.id ?? 1),
    help_center_enabled: raw.help_center_enabled !== false,
    voice_enabled: raw.voice_enabled === true,
    voice_connectivity_verified_at:
      (raw.voice_connectivity_verified_at as string | null) ?? null,
    weekly_allowance_seconds: Number(raw.weekly_allowance_seconds ?? 600),
    max_session_seconds: Number(raw.max_session_seconds ?? 120),
    lease_seconds: Number(raw.lease_seconds ?? 20),
    gemini_model_id: normalizeModelId(raw.gemini_model_id) || "gemini-3.8-live",
    supported_locales: locales,
    session_resumption_enabled: raw.session_resumption_enabled === true,
    emergency_disabled: raw.emergency_disabled === true,
    emergency_reason: (raw.emergency_reason as string | null) ?? null,
    emergency_disabled_at:
      (raw.emergency_disabled_at as string | null) ?? null,
    emergency_disabled_by:
      (raw.emergency_disabled_by as string | null) ?? null,
    updated_at: (raw.updated_at as string | null) ?? null,
    updated_by: (raw.updated_by as string | null) ?? null,
  };
}

/** Public API shape — never includes secrets. */
export function publicAiSettingsView(row: AiSettingsRow) {
  const locales = row.supported_locales.filter(isSettingsLocale);
  const default_locale = locales[0] ?? "en";
  return {
    help_center_enabled: row.help_center_enabled,
    voice_enabled: row.voice_enabled,
    voice_connectivity_verified_at: row.voice_connectivity_verified_at,
    weekly_allowance_seconds: row.weekly_allowance_seconds,
    max_session_seconds: row.max_session_seconds,
    lease_seconds: row.lease_seconds,
    gemini_model_id: row.gemini_model_id,
    supported_locales: locales.length ? locales : [...SKG_AI_SETTINGS_LOCALES],
    default_locale,
    session_resumption_enabled: row.session_resumption_enabled,
    emergency_disabled: row.emergency_disabled,
    emergency_reason: row.emergency_reason,
    emergency_disabled_at: row.emergency_disabled_at,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
    bounds: SKG_AI_SETTINGS_BOUNDS,
    allowed_models: [...SKG_AI_ALLOWED_LIVE_MODELS],
    /** Schema gaps — documented for UI honesty. */
    schema_notes: {
      skg_only_scope: "Managed in AI Instructions (skg_ai_instructions), not settings.",
      fallback_message:
        "Managed in AI Instructions fallback_message / refusal_message.",
      support_contact:
        "No dedicated support contact columns; use Instructions fallback copy.",
      text_token_limits:
        "No max response/context token columns; voice limits use max_session_seconds and lease_seconds.",
      maintenance_mode:
        "Use emergency_disabled (maintenance / kill-switch) via emergency endpoints.",
    },
  };
}

export function settingsAuditSnapshot(
  row: Partial<AiSettingsRow> | null | undefined,
): Record<string, unknown> {
  if (!row) return {};
  return {
    help_center_enabled: row.help_center_enabled ?? null,
    voice_enabled: row.voice_enabled ?? null,
    voice_connectivity_verified_at: row.voice_connectivity_verified_at ?? null,
    weekly_allowance_seconds: row.weekly_allowance_seconds ?? null,
    max_session_seconds: row.max_session_seconds ?? null,
    lease_seconds: row.lease_seconds ?? null,
    gemini_model_id: row.gemini_model_id ?? null,
    supported_locales: row.supported_locales ?? null,
    session_resumption_enabled: row.session_resumption_enabled ?? null,
    emergency_disabled: row.emergency_disabled ?? null,
    emergency_reason: row.emergency_reason ?? null,
    emergency_disabled_at: row.emergency_disabled_at ?? null,
  };
}
