import { requireAdminPermission } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import { parseFraudReportCreateInput } from "@/lib/fraud-report-input";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  // A valid admin login is insufficient for privileged service-role writes.
  const adminGate = await requireAdminPermission("fraud.manage", {
    request,
    auditModule: "fraud",
  });
  if (!adminGate.ok) return adminGate.response;

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
  try {
    const { data, error } = await supabaseAdmin
      .from("fraud_reports")
      .insert({ from_user_id, to_user_id, reason, description })
      .select()
      .single();

    if (error) {
      void recordFailure({
        actor: adminGate.actor,
        action: "fraud_report_created",
        module: "fraud",
        description: "Failed to create fraud report",
        resourceType: "fraud_report",
        relatedUserId: to_user_id,
        reason: error.message,
        metadata: { from_user_id, to_user_id, reason },
        ...clientMetaFromRequest(request),
      });
      // The DB may return table/constraint details; do not expose these to clients.
      return NextResponse.json(
        { error: "Unable to create fraud report. Verify member IDs and try again." },
        { status: 400 },
      );
    }

    void recordSuccess({
      actor: adminGate.actor,
      action: "fraud_report_created",
      module: "fraud",
      description: `Fraud report created: ${reason}`,
      resourceType: "fraud_report",
      resourceId: data?.id != null ? String(data.id) : undefined,
      relatedUserId: to_user_id,
      // Don't duplicate free-text allegations into the audit-log payload.
      afterData: {
        from_user_id,
        to_user_id,
        reason,
        descriptionProvided: description !== null,
      },
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
