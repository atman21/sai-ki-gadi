import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";

/** Keep only small primitive provider fields for audit metadata. */
function summarizeProviderPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string" && value.length <= 200) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Admin-only proxy to force a Lucky Draw FCM send for today's winner.
 * Never exposes the service-role key to the browser.
 */
export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const auditBase = {
    actor: gate.actor,
    module: "notifications",
    resourceType: "lucky_draw_notification_test",
    ...clientMetaFromRequest(request),
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    void recordFailure({
      ...auditBase,
      action: "lucky_draw_notification_test_failed",
      description: "Lucky draw notification send was requested but server configuration is incomplete",
      reason: "Supabase server configuration is incomplete.",
      metadata: { requested: true, providerInvoked: false },
    });
    return NextResponse.json(
      { ok: false, error: "Supabase server configuration is incomplete." },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/send-lucky-draw-notification`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ force: true }),
      },
    );

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      void recordFailure({
        ...auditBase,
        action: "lucky_draw_notification_test_failed",
        description: `Lucky draw notification send was requested; edge function returned HTTP ${response.status}`,
        reason: `Edge function returned ${response.status}`,
        metadata: {
          requested: true,
          providerInvoked: true,
          providerStatus: response.status,
          providerResult: summarizeProviderPayload(payload),
        },
      });
      return NextResponse.json(
        {
          ok: false,
          error:
            (payload &&
              typeof payload === "object" &&
              "error" in payload &&
              typeof (payload as { error: unknown }).error === "string" &&
              (payload as { error: string }).error) ||
            `Edge function returned ${response.status}`,
        },
        { status: response.status >= 400 ? response.status : 502 },
      );
    }

    void recordSuccess({
      ...auditBase,
      action: "lucky_draw_notification_test_sent",
      description: "Lucky draw notification send requested by admin; edge function accepted the request (delivery results are reported by the provider, not guaranteed)",
      metadata: {
        requested: true,
        providerInvoked: true,
        providerStatus: response.status,
        providerResult: summarizeProviderPayload(payload),
      },
    });

    return NextResponse.json({
      ok: true,
      result: payload,
    });
  } catch {
    void recordFailure({
      ...auditBase,
      action: "lucky_draw_notification_test_failed",
      description: "Lucky draw notification send was requested but the edge function could not be invoked",
      reason: "Edge function invocation failed",
      metadata: { requested: true, providerInvoked: false },
    });
    return NextResponse.json(
      { ok: false, error: "Failed to invoke Lucky Draw notification function." },
      { status: 502 },
    );
  }
}
