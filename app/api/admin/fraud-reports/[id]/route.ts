import { requireAdminPermission } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import {
  isFraudReportUuid,
  parseFraudReportCreateInput,
} from "@/lib/fraud-report-input";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const WRITE_ERROR = "Unable to update fraud report. Verify the report and member IDs.";

function auditSnapshot(row: {
  from_user_id: string;
  to_user_id: string;
  reason: string;
  description: string | null;
} | null) {
  if (!row) return null;
  return {
    from_user_id: row.from_user_id,
    to_user_id: row.to_user_id,
    reason: row.reason,
    descriptionProvided: row.description != null && row.description !== "",
  };
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const adminGate = await requireAdminPermission("fraud.manage", {
    request,
    auditModule: "fraud",
  });
  if (!adminGate.ok) return adminGate.response;

  try {
    const { id } = await params;
    if (!isFraudReportUuid(id)) {
      return NextResponse.json({ error: "Invalid fraud report id." }, { status: 400 });
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const input = parseFraudReportCreateInput(json);
    if (!input) {
      return NextResponse.json(
        { error: "Valid member IDs and a report reason are required." },
        { status: 400 },
      );
    }

    const { from_user_id, to_user_id, reason, description } = input;

    const { data: before } = await supabaseAdmin
      .from("fraud_reports")
      .select("from_user_id, to_user_id, reason, description")
      .eq("id", id)
      .maybeSingle();

    const { data, error } = await supabaseAdmin
      .from("fraud_reports")
      .update({ from_user_id, to_user_id, reason, description })
      .eq("id", id)
      .select("id, from_user_id, to_user_id, reason, description, created_at")
      .single();

    if (error) {
      void recordFailure({
        actor: adminGate.actor,
        action: "fraud_report_updated",
        module: "fraud",
        description: `Failed to update fraud report ${id}`,
        resourceType: "fraud_report",
        resourceId: id,
        relatedUserId: to_user_id,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ error: WRITE_ERROR }, { status: 400 });
    }

    const beforeAudit = auditSnapshot(before);
    const afterAudit = auditSnapshot({
      from_user_id,
      to_user_id,
      reason,
      description,
    });
    const changedFields: string[] = (["from_user_id", "to_user_id", "reason"] as const).filter(
      (key) => (before?.[key] ?? null) !== (afterAudit?.[key] ?? null),
    );
    if ((before?.description ?? null) !== description) changedFields.push("description");
    void recordSuccess({
      actor: adminGate.actor,
      action: "fraud_report_updated",
      module: "fraud",
      description: `Fraud report ${id} updated`,
      resourceType: "fraud_report",
      resourceId: id,
      relatedUserId: to_user_id,
      changedFields,
      beforeData: beforeAudit,
      afterData: afterAudit,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json(data);
  } catch {
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
  const adminGate = await requireAdminPermission("fraud.manage", {
    request,
    auditModule: "fraud",
  });
  if (!adminGate.ok) return adminGate.response;

  try {
    const { id } = await params;
    if (!isFraudReportUuid(id)) {
      return NextResponse.json({ error: "Invalid fraud report id." }, { status: 400 });
    }

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
        actor: adminGate.actor,
        action: "fraud_report_deleted",
        module: "fraud",
        description: `Failed to delete fraud report ${id}`,
        resourceType: "fraud_report",
        resourceId: id,
        relatedUserId: before?.to_user_id ?? null,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json(
        { error: "Unable to delete fraud report." },
        { status: 400 },
      );
    }

    void recordSuccess({
      actor: adminGate.actor,
      action: "fraud_report_deleted",
      module: "fraud",
      description: `Fraud report ${id} deleted`,
      resourceType: "fraud_report",
      resourceId: id,
      relatedUserId: before?.to_user_id ?? null,
      beforeData: auditSnapshot(before),
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
