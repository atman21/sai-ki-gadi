import { requireAdminApi } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const { id } = await params;

    const body = await request.json();

    const { from_user_id, to_user_id, reason, description } = body;

    const { data: before } = await supabaseAdmin
      .from("fraud_reports")
      .select("from_user_id, to_user_id, reason, description")
      .eq("id", id)
      .maybeSingle();

    const { data, error } = await supabaseAdmin
      .from("fraud_reports")
      .update({
        from_user_id,
        to_user_id,
        reason,
        description,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      void recordFailure({
        actor: __adminGate.actor,
        action: "fraud_report_updated",
        module: "fraud",
        description: `Failed to update fraud report ${id}`,
        resourceType: "fraud_report",
        resourceId: id,
        relatedUserId: to_user_id ?? before?.to_user_id ?? null,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const afterData = { from_user_id, to_user_id, reason, description };
    void recordSuccess({
      actor: __adminGate.actor,
      action: "fraud_report_updated",
      module: "fraud",
      description: `Fraud report ${id} updated`,
      resourceType: "fraud_report",
      resourceId: id,
      relatedUserId: to_user_id ?? before?.to_user_id ?? null,
      changedFields: Object.keys(afterData).filter(
        (key) =>
          JSON.stringify((before as Record<string, unknown> | null)?.[key] ?? null) !==
          JSON.stringify((afterData as Record<string, unknown>)[key] ?? null),
      ),
      beforeData: before ?? null,
      afterData,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update fraud report" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const { id } = await params;

    const { data: before } = await supabaseAdmin
      .from("fraud_reports")
      .select("from_user_id, to_user_id, reason, description")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("fraud_reports")
      .delete()
      .eq("id", id);

    if (error) {
      void recordFailure({
        actor: __adminGate.actor,
        action: "fraud_report_deleted",
        module: "fraud",
        description: `Failed to delete fraud report ${id}`,
        resourceType: "fraud_report",
        resourceId: id,
        relatedUserId: before?.to_user_id ?? null,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    void recordSuccess({
      actor: __adminGate.actor,
      action: "fraud_report_deleted",
      module: "fraud",
      description: `Fraud report ${id} deleted`,
      resourceType: "fraud_report",
      resourceId: id,
      relatedUserId: before?.to_user_id ?? null,
      beforeData: before ?? null,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({
      success: true,
    });
  } catch {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
