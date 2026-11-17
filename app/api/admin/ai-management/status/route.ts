import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import { AI_MANAGEMENT_NAV_ITEMS } from "@/lib/ai-management-nav";

/**
 * Phase 1 readiness probe for the SKG AI Management Console shell.
 * Does not call Gemini, read skg_ai_* tables, or mutate settings.
 */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("help_ai.view", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  return NextResponse.json({
    ok: true,
    phase: 1,
    console: "skg-ai-management",
    featuresEnabled: false,
    sections: AI_MANAGEMENT_NAV_ITEMS.map((item) => ({
      key: item.key,
      label: item.label,
      viewPermission: item.viewPermission,
      managePermission: item.managePermission,
    })),
  });
}
