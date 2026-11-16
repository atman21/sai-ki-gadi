import { NextResponse } from "next/server";

import {
  requireAdminPermission,
  safeErrorMessage,
} from "@/lib/admin-api";
import { listInstructionVersions } from "@/lib/ai-instructions-store";

/**
 * GET — version history for AI instructions (help_ai.view).
 * Returns metadata + field lengths; full snapshot bodies are included for
 * Admin preview only (this route is Admin-authenticated, not public).
 */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("help_ai.view", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  try {
    const versions = await listInstructionVersions(40);
    return NextResponse.json({
      ok: true,
      versions: versions.map((entry) => ({
        version: entry.version,
        status: entry.status,
        change_reason: entry.change_reason,
        changed_by: entry.changed_by,
        created_at: entry.created_at,
        title: entry.snapshot.title,
        allowed_topics: entry.snapshot.allowed_topics,
        lengths: {
          main_system_instruction: entry.snapshot.main_system_instruction.length,
          skg_scope_restriction: entry.snapshot.skg_scope_restriction.length,
          refusal_message: entry.snapshot.refusal_message.length,
          fallback_message: entry.snapshot.fallback_message.length,
          language_behavior: entry.snapshot.language_behavior.length,
        },
        // Full snapshot available to authorized Admins for restore/preview.
        snapshot: entry.snapshot,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load instruction versions."),
      },
      { status: 500 },
    );
  }
}
