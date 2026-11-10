import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import {
  DISPUTED_EVIDENCE_BUCKET,
  validateRemarks,
} from "@/lib/disputed-number-evidence";
import {
  isValidDisputedMobile,
  normalizeIndianMobileForReference,
} from "@/lib/normalize-indian-mobile";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("disputed_numbers.view", {
    request,
    auditModule: "disputed_numbers",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const { data, error } = await supabaseAdmin
    .from("disputed_numbers")
    .select(
      "id, mobile_number, remarks, evidence_path, created_by, updated_by, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, row: data });
}

export async function PATCH(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("disputed_numbers.manage", {
    request,
    auditModule: "disputed_numbers",
  });
  if (!gate.ok) return gate.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const { data: before } = await supabaseAdmin
      .from("disputed_numbers")
      .select(
        "id, mobile_number, remarks, evidence_path, created_by, updated_by, created_at, updated_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (!before) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const patch: Record<string, unknown> = {
      updated_by: gate.actor.id ?? null,
    };

    if (body?.mobile_number != null) {
      const normalized = normalizeIndianMobileForReference(body.mobile_number);
      if (!isValidDisputedMobile(normalized)) {
        return NextResponse.json(
          { ok: false, error: "Enter a valid 10-digit Indian mobile number." },
          { status: 400 },
        );
      }
      patch.mobile_number = normalized;
    }

    if (body?.remarks != null) {
      const remarks = validateRemarks(body.remarks);
      if (!remarks.ok) {
        return NextResponse.json(
          { ok: false, error: remarks.error },
          { status: 400 },
        );
      }
      patch.remarks = remarks.value;
    }

    const { data, error } = await supabaseAdmin
      .from("disputed_numbers")
      .update(patch)
      .eq("id", id)
      .select(
        "id, mobile_number, remarks, evidence_path, created_by, updated_by, created_at, updated_at",
      )
      .single();

    if (error) {
      const isDup =
        error.code === "23505" || /duplicate|unique/i.test(error.message);
      void recordFailure({
        actor: gate.actor,
        action: "disputed_number_updated",
        module: "disputed_numbers",
        description: "Failed to update disputed number",
        resourceType: "disputed_number",
        resourceId: id,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json(
        {
          ok: false,
          error: isDup
            ? "This mobile number is already in the disputed list."
            : error.message,
        },
        { status: isDup ? 409 : 400 },
      );
    }

    void recordSuccess({
      actor: gate.actor,
      action: "disputed_number_updated",
      module: "disputed_numbers",
      description: `Disputed number ${data.mobile_number} updated`,
      resourceType: "disputed_number",
      resourceId: id,
      beforeData: before,
      afterData: data,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true, row: data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("disputed_numbers.manage", {
    request,
    auditModule: "disputed_numbers",
  });
  if (!gate.ok) return gate.response;

  try {
    const { id } = await context.params;
    const { data: before } = await supabaseAdmin
      .from("disputed_numbers")
      .select("id, mobile_number, evidence_path")
      .eq("id", id)
      .maybeSingle();

    if (!before) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from("disputed_numbers")
      .delete()
      .eq("id", id);

    if (error) {
      void recordFailure({
        actor: gate.actor,
        action: "disputed_number_deleted",
        module: "disputed_numbers",
        description: "Failed to delete disputed number",
        resourceType: "disputed_number",
        resourceId: id,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    // Delete evidence only after DB delete succeeds.
    if (before.evidence_path) {
      await supabaseAdmin.storage
        .from(DISPUTED_EVIDENCE_BUCKET)
        .remove([before.evidence_path]);
    }

    void recordSuccess({
      actor: gate.actor,
      action: "disputed_number_deleted",
      module: "disputed_numbers",
      description: `Disputed number ${before.mobile_number} deleted`,
      resourceType: "disputed_number",
      resourceId: id,
      beforeData: before,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
