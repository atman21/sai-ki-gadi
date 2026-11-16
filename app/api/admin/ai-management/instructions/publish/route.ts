import { NextResponse } from "next/server";

import {
  requireAdminPermission,
  safeErrorMessage,
} from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordChange,
  recordFailure,
} from "@/lib/admin-audit";
import {
  composeFinalInstruction,
  fieldsFromDocument,
  instructionAuditSnapshot,
} from "@/lib/ai-instructions";
import { publishInstructionDraft } from "@/lib/ai-instructions-store";

/**
 * POST — publish current draft as a new published version (help_ai.manage).
 * Saving a draft via PUT never publishes.
 */
export async function POST(request: Request) {
  const gate = await requireAdminPermission("help_ai.manage", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const auditBase = {
    actor: gate.actor,
    module: "help_ai",
    resourceType: "skg_ai_instruction",
    resourceId: "skg-ai-global-instructions",
    ...clientMetaFromRequest(request),
  };

  try {
    const body = await request.json().catch(() => ({}));
    const changeReason =
      body && typeof body === "object" && !Array.isArray(body)
        ? String((body as { change_reason?: unknown }).change_reason ?? "")
        : "";

    const result = await publishInstructionDraft({
      actorId: gate.actor.id,
      changeReason: changeReason || "publish",
    });

    void recordChange({
      ...auditBase,
      action: "help_ai.instruction.publish",
      description: `Published AI instruction v${result.published.version}`,
      changedFields: ["status", "version", "published_at", "published_version"],
      beforeData: {
        status: "draft",
        version: result.published.version - 1,
      },
      afterData: instructionAuditSnapshot(result.published),
    });

    return NextResponse.json({
      ok: true,
      draft: result.draft,
      published: result.published,
      published_preview_text: composeFinalInstruction(
        fieldsFromDocument(result.published),
      ),
      gemini_runtime_enforced: true,
      note: "Published to Postgres global-published. Staging Edge mint injects this into Gemini Live systemInstruction after deploy.",
    });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.instruction.publish",
      description: "Failed to publish AI instruction",
      reason: safeErrorMessage(error, "publish_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to publish AI instruction."),
      },
      { status: 500 },
    );
  }
}
