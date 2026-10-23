import { requireAdminApi } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

export async function PUT(
  request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const { id } = await context.params;

    const body = await request.json();

    const {
      status,
      membership_type,
      membership_duration_days,
      welcome_completed,
      admin_remarks,
    } = body;

    const updateData: Record<string, unknown> = {};
    let membershipAudit: Record<string, unknown> | null = null;

    if (typeof status === "boolean") {
      updateData.status = status;
    }

    if (typeof welcome_completed === "boolean") {
      updateData.welcome_completed = welcome_completed;
    }

    if (typeof admin_remarks === "string") {
      updateData.admin_remarks = admin_remarks;
    }

    if (membership_type) {
      if (membership_type !== "gold" && membership_type !== "regular") {
        return NextResponse.json({ error: "Invalid membership type" }, { status: 400 });
      }
      const days = membership_type === "gold" ? Number(membership_duration_days) : null;
      if (membership_type === "gold" && (!Number.isInteger(days) || days! < 1 || days! > 3660)) {
        return NextResponse.json({ error: "Membership duration must be 1–3660 days" }, { status: 400 });
      }
      const amount = body.membership_amount === "" || body.membership_amount == null ? null : Number(body.membership_amount);
      if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
        return NextResponse.json({ error: "Invalid membership amount" }, { status: 400 });
      }
      const paymentStatus = body.membership_payment_status ?? "not_recorded";
      if (!["not_recorded", "paid", "pending"].includes(paymentStatus)) {
        return NextResponse.json({ error: "Invalid payment status" }, { status: 400 });
      }
      const { error: membershipError } = await supabaseAdmin.rpc("admin_set_user_membership", {
        p_user_id: id,
        p_membership_type: membership_type,
        p_duration_days: days,
        p_amount: amount,
        p_payment_reference: typeof body.membership_payment_reference === "string" ? body.membership_payment_reference.trim() || null : null,
        p_payment_status: paymentStatus,
      });
      if (membershipError) {
        void recordFailure({
          actor: __adminGate.actor,
          action: "user_updated",
          module: "members",
          description: `Failed to update membership for member ${id}`,
          resourceType: "user",
          resourceId: id,
          relatedUserId: id,
          reason: membershipError.message,
          metadata: { membership_type, membership_duration_days: days },
          ...clientMetaFromRequest(request),
        });
        return NextResponse.json({ error: membershipError.message }, { status: 500 });
      }
      membershipAudit = {
        membership_type,
        membership_duration_days: days,
        membership_amount: amount,
        membership_payment_status: paymentStatus,
        has_payment_reference:
          typeof body.membership_payment_reference === "string" &&
          body.membership_payment_reference.trim().length > 0,
      };
    }

    if (Object.keys(updateData).length === 0) {
      if (membership_type) {
        void recordSuccess({
          actor: __adminGate.actor,
          action: "user_updated",
          module: "members",
          description: `Membership updated for member ${id}`,
          resourceType: "user",
          resourceId: id,
          relatedUserId: id,
          metadata: { membership: membershipAudit },
          ...clientMetaFromRequest(request),
        });
        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ error: "No updates supplied" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("users")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("UPDATE USER ERROR:", error);

      void recordFailure({
        actor: __adminGate.actor,
        action: "user_updated",
        module: "members",
        description: `Failed to update member ${id}`,
        resourceType: "user",
        resourceId: id,
        relatedUserId: id,
        reason: error.message,
        changedFields: Object.keys(updateData),
        metadata: { membership: membershipAudit },
        ...clientMetaFromRequest(request),
      });

      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 500,
        },
      );
    }

    void recordSuccess({
      actor: __adminGate.actor,
      action: "user_updated",
      module: "members",
      description: `Member ${id} updated`,
      resourceType: "user",
      resourceId: id,
      relatedUserId: id,
      changedFields: [
        ...Object.keys(updateData),
        ...(membershipAudit ? ["membership"] : []),
      ],
      afterData: updateData,
      metadata: { membership: membershipAudit },
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({
      success: true,
      user: data,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Something went wrong",
      },
      {
        status: 500,
      },
    );
  }
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const { id } = await context.params;

    const { data: before } = await supabaseAdmin
      .from("users")
      .select("id, first_name, last_name, phone")
      .eq("id", id)
      .maybeSingle();
    const entityLabel =
      [before?.first_name, before?.last_name].filter(Boolean).join(" ").trim() ||
      before?.phone ||
      id;

    const { error } = await supabaseAdmin.from("users").delete().eq("id", id);

    if (error) {
      console.error("DELETE USER ERROR:", error);

      void recordFailure({
        actor: __adminGate.actor,
        action: "user_deleted",
        module: "members",
        description: `Failed to delete member ${entityLabel}`,
        resourceType: "user",
        resourceId: id,
        entityLabel,
        relatedUserId: id,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });

      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 500,
        },
      );
    }

    await recordSuccess({
      actor: __adminGate.actor,
      action: "user_deleted",
      module: "members",
      description: `Member ${entityLabel} deleted`,
      resourceType: "user",
      resourceId: id,
      entityLabel,
      relatedUserId: id,
      beforeData: before
        ? {
            first_name: before.first_name,
            last_name: before.last_name,
            phone: before.phone,
          }
        : null,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Something went wrong",
      },
      {
        status: 500,
      },
    );
  }
}
