import { requireAdminApi } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const body = await request.json();

    const { from_user_id, to_user_id, reason, description } = body;

    const { data, error } = await supabaseAdmin
      .from("fraud_reports")
      .insert({
        from_user_id,
        to_user_id,
        reason,
        description,
      })
      .select()
      .single();

    if (error) {
      void recordFailure({
        actor: __adminGate.actor,
        action: "fraud_report_created",
        module: "fraud",
        description: "Failed to create fraud report",
        resourceType: "fraud_report",
        relatedUserId: to_user_id ?? from_user_id ?? null,
        reason: error.message,
        metadata: { from_user_id, to_user_id, reason },
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    void recordSuccess({
      actor: __adminGate.actor,
      action: "fraud_report_created",
      module: "fraud",
      description: `Fraud report created${reason ? `: ${reason}` : ""}`,
      resourceType: "fraud_report",
      resourceId: data?.id != null ? String(data.id) : undefined,
      relatedUserId: to_user_id ?? from_user_id ?? null,
      afterData: { from_user_id, to_user_id, reason, description },
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
