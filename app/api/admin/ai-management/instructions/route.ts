import { NextResponse } from "next/server";

import {
  requireAdminPermission,
  safeErrorMessage,
} from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  diffChangedFields,
  recordChange,
  recordFailure,
} from "@/lib/admin-audit";
import { actorHasPermission } from "@/lib/admin-rbac";
import {
  composeFinalInstruction,
  fieldsFromDocument,
  instructionAuditSnapshot,
  sanitizeInstructionFields,
} from "@/lib/ai-instructions";
import {
  describeGeminiInstructionIntegrationGap,
  GEMINI_LIVE_INSTRUCTION_INTEGRATION,
} from "@/lib/ai-instructions-gemini-adapter";
import {
  loadInstructionsSnapshot,
  saveInstructionDraft,
} from "@/lib/ai-instructions-store";

/**
 * GET — load draft + published AI instructions (help_ai.view).
 * PUT — save draft only (help_ai.manage). Does not publish.
 */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("help_ai.view", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  try {
    const snapshot = await loadInstructionsSnapshot();
    const canManage = actorHasPermission(gate.actor, "help_ai.manage");

    return NextResponse.json({
      ok: true,
      can_manage: canManage,
      draft: snapshot.draft,
      published: snapshot.published,
      preview_text: snapshot.preview_text,
      published_preview_text: snapshot.published
        ? composeFinalInstruction(fieldsFromDocument(snapshot.published))
        : null,
      storage: {
        kind: snapshot.storage,
        path: snapshot.storage_path,
        note: "Postgres skg_ai_instructions — published row is Gemini runtime source of truth.",
      },
      gemini: {
        ...GEMINI_LIVE_INSTRUCTION_INTEGRATION,
        gap: describeGeminiInstructionIntegrationGap(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load AI instructions."),
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
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
    const body = await request.json().catch(() => null);
    const sanitized = sanitizeInstructionFields(body);
    if (!sanitized.ok) {
      return NextResponse.json(
        { ok: false, error: sanitized.error },
        { status: 400 },
      );
    }

    const before = await loadInstructionsSnapshot();
    const draft = await saveInstructionDraft({
      fields: sanitized.fields,
      actorId: gate.actor.id,
    });

    void recordChange({
      ...auditBase,
      action: "help_ai.instruction.update",
      description: "Saved AI instruction draft",
      changedFields: diffChangedFields(
        instructionAuditSnapshot(before.draft),
        instructionAuditSnapshot(draft),
      ),
      beforeData: instructionAuditSnapshot(before.draft),
      afterData: instructionAuditSnapshot(draft),
    });

    return NextResponse.json({
      ok: true,
      draft,
      preview_text: composeFinalInstruction(fieldsFromDocument(draft)),
      published: before.published,
      note: "Draft saved. Publish separately to mark a version as published.",
    });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.instruction.update",
      description: "Failed to save AI instruction draft",
      reason: safeErrorMessage(error, "save_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to save AI instruction draft."),
      },
      { status: 500 },
    );
  }
}
