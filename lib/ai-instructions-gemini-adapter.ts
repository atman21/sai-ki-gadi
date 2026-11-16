/**
 * Gemini Live integration adapter for SKG AI Instructions (Phase 2D).
 *
 * Runtime (Mobile Edge `mint-skg-ai-live-token`):
 * - Loads `global-published` from Postgres via service_role
 * - Locks `bidiGenerateContentSetup.systemInstruction` in the ephemeral token
 * - Drafts are never loaded
 * - With empty fieldMask + setup present, client WS setup is ignored
 *
 * This module builds the intended payload shape for Admin preview / tests.
 */

import {
  composeFinalInstruction,
  type AiInstructionFields,
} from "@/lib/ai-instructions";

export const GEMINI_LIVE_INSTRUCTION_INTEGRATION = {
  edge_function: "mint-skg-ai-live-token",
  shared_builder: "supabase/functions/_shared/skg-ai-live-token.ts",
  setup_field: "bidiGenerateContentSetup.systemInstruction",
  client_socket: "services/help/skg-ai-live-socket.ts",
  status: "wired_server_side" as const,
  runtime_enforced: true,
  reason:
    "Published instructions are injected server-side into the ephemeral token lock. Mobile client WS setup does not carry the private prompt.",
} as const;

/**
 * Intended Gemini Live parts payload for systemInstruction.
 * Compatible with Google GenAI Live / BidiGenerateContent setup conventions.
 */
export function buildGeminiLiveSystemInstructionParts(
  fields: AiInstructionFields,
): { parts: Array<{ text: string }> } {
  return {
    parts: [{ text: composeFinalInstruction(fields) }],
  };
}

/**
 * Shows how `bidiGenerateContentSetup` looks once published text is locked.
 */
export function buildProposedBidiGenerateContentSetup(args: {
  modelId: string;
  fields: AiInstructionFields;
  sessionResumptionEnabled?: boolean;
}): Record<string, unknown> {
  const setup: Record<string, unknown> = {
    model: `models/${args.modelId}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
    },
    systemInstruction: buildGeminiLiveSystemInstructionParts(args.fields),
  };
  if (args.sessionResumptionEnabled) {
    setup.sessionResumption = {};
  }
  return setup;
}

export function describeGeminiInstructionIntegrationGap(): {
  admin_module_complete: boolean;
  runtime_enforcement: boolean;
  remaining_work: string[];
} {
  return {
    admin_module_complete: true,
    runtime_enforcement: true,
    remaining_work: [
      "Apply Phase 2D migration on Staging (not Production).",
      "Deploy mint-skg-ai-live-token Edge Function to Staging.",
      "Deploy Admin Web with Postgres instruction store to Staging.",
      "Runtime-verify SKG vs unrelated (e.g. RedBus) voice answers after publish.",
    ],
  };
}
