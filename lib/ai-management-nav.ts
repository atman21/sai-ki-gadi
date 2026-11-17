import type { AdminPermission } from "@/lib/admin-permissions";

/**
 * Phase 1 SKG AI Management Console — navigation contract only.
 * No Gemini, Knowledge CRUD, or runtime AI controls live here yet.
 */

export const AI_MANAGEMENT_TAB_KEYS = [
  "ai-dashboard",
  "ai-settings",
  "ai-knowledge-base",
  "ai-knowledge-import",
  "ai-instructions",
  "ai-faq-help",
  "ai-tools",
  "ai-test-assistant",
  "ai-conversations",
  "ai-usage",
  "ai-security-audit",
] as const;

export type AiManagementTabKey = (typeof AI_MANAGEMENT_TAB_KEYS)[number];

export type AiManagementNavItem = {
  key: AiManagementTabKey;
  label: string;
  /** Permission required to see the tab / open the placeholder page. */
  viewPermission: AdminPermission;
  /**
   * Permission required for future management actions on this page.
   * View-only actors see the shell but Phase 1 shows no mutating controls.
   */
  managePermission: AdminPermission | null;
  summary: string;
  phaseNote: string;
};

export const AI_MANAGEMENT_NAV_GROUP_TITLE = "SKG AI MANAGEMENT";

export const AI_MANAGEMENT_NAV_ITEMS: readonly AiManagementNavItem[] = [
  {
    key: "ai-dashboard",
    label: "AI Dashboard",
    viewPermission: "help_ai.view",
    managePermission: null,
    summary: "Overview of AI status, quotas, and operational health.",
    phaseNote:
      "Phase 2B dashboard reads skg_ai_settings, FAQ counts, and voice sessions.",
  },
  {
    key: "ai-settings",
    label: "AI Settings",
    viewPermission: "help_ai.manage",
    managePermission: "help_ai.manage",
    summary: "Help Center / Voice toggles, quotas, model, and emergency stop.",
    phaseNote:
      "Reads/writes skg_ai_settings via Admin APIs. Emergency uses emergency_terminate_skg_ai_sessions. Prompt/scope/fallback stay in AI Instructions.",
  },
  {
    key: "ai-knowledge-base",
    label: "Knowledge Base",
    viewPermission: "help_ai.view",
    managePermission: "help_ai.manage",
    summary: "Manual and published AI knowledge entries.",
    phaseNote:
      "Phase 3B Admin CRUD + approval workflow. Migration source only (not applied). Gemini retrieval not wired.",
  },
  {
    key: "ai-knowledge-import",
    label: "Knowledge Import",
    viewPermission: "help_ai.manage",
    managePermission: "help_ai.manage",
    summary: "Import documents into draft Knowledge Base articles.",
    phaseNote:
      "Phase 3C upload/extract/review → draft articles only. Private bucket. Gemini not auto-published.",
  },
  {
    key: "ai-instructions",
    label: "AI Instructions",
    viewPermission: "help_ai.view",
    managePermission: "help_ai.manage",
    summary: "Global and feature-specific AI instructions with version history.",
    phaseNote:
      "Phase 2C Admin editor (filesystem store). Gemini Live does not inject systemInstruction yet.",
  },
  {
    key: "ai-faq-help",
    label: "FAQ & Help Center",
    viewPermission: "help.view",
    managePermission: "help.manage",
    summary: "FAQ categories, translations (en/hi/gu), draft and publish.",
    phaseNote:
      "Phase 1 placeholder. Uses existing Mobile help_faq_* tables in later phases.",
  },
  {
    key: "ai-tools",
    label: "AI Tools & Permissions",
    viewPermission: "help_ai.manage",
    managePermission: "help_ai.manage",
    summary: "Tool registry and allowed app actions for AI.",
    phaseNote: "Phase 1 placeholder. No tool execution surface yet.",
  },
  {
    key: "ai-test-assistant",
    label: "Test Assistant",
    viewPermission: "help_ai.manage",
    managePermission: "help_ai.manage",
    summary: "Connectivity and sandboxed assistant checks.",
    phaseNote:
      "Phase 1 placeholder. Does not invoke Gemini or mint Live tokens.",
  },
  {
    key: "ai-conversations",
    label: "Conversations & Sessions",
    viewPermission: "help_ai.view",
    managePermission: null,
    summary: "Voice session monitoring without transcript storage.",
    phaseNote:
      "Phase 1 placeholder. Reads of skg_ai_voice_sessions come later.",
  },
  {
    key: "ai-usage",
    label: "Usage & Analytics",
    viewPermission: "help_ai.view",
    managePermission: null,
    summary: "Weekly quotas, session counts, and failure trends.",
    phaseNote: "Phase 1 placeholder. No analytics queries yet.",
  },
  {
    key: "ai-security-audit",
    label: "Security & Audit Logs",
    viewPermission: "help_ai.view",
    managePermission: "help_ai.manage",
    summary: "AI-specific security events and change audit trail.",
    phaseNote:
      "Phase 1 placeholder. Uses admin_panel_audit_logs conventions later.",
  },
] as const;

export function isAiManagementTabKey(
  value: string | null | undefined,
): value is AiManagementTabKey {
  return (
    typeof value === "string" &&
    (AI_MANAGEMENT_TAB_KEYS as readonly string[]).includes(value)
  );
}

export function getAiManagementNavItem(
  key: AiManagementTabKey,
): AiManagementNavItem {
  const item = AI_MANAGEMENT_NAV_ITEMS.find((entry) => entry.key === key);
  if (!item) {
    throw new Error(`Unknown AI management tab: ${key}`);
  }
  return item;
}

/** Tabs visible to an actor that has the listed permission set. */
export function filterAiManagementNavItems(
  hasPermission: (permission: AdminPermission) => boolean,
): AiManagementNavItem[] {
  return AI_MANAGEMENT_NAV_ITEMS.filter((item) =>
    hasPermission(item.viewPermission),
  );
}

export function isAiManagementNavGroupTitle(title: string): boolean {
  return title === AI_MANAGEMENT_NAV_GROUP_TITLE;
}

/**
 * Panel access for AI Management tabs.
 * Client-side only — does not replace server API authorization.
 */
export function resolveAiManagementPanelAccess(
  tabKey: AiManagementTabKey,
  opts: {
    permissionsReady: boolean;
    hasPermission: (permission: AdminPermission) => boolean;
  },
): "loading" | "denied" | "allow" {
  if (!opts.permissionsReady) return "loading";
  const required = getAiManagementNavItem(tabKey).viewPermission;
  return opts.hasPermission(required) ? "allow" : "denied";
}
