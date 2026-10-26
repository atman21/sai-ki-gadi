import { NextResponse } from "next/server";

import { requireAdminApi, safeErrorMessage } from "@/lib/admin-api";
import { writeAdminAuditLog, clientMetaFromRequest } from "@/lib/admin-audit";
import {
  getManualGoldDowngradeBlockReason,
  getMembershipLifecycleStatus,
} from "@/lib/admin-membership-status";
import { actorHasPermission } from "@/lib/admin-rbac";

export async function PUT(
  request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

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
        return NextResponse.json(
          { error: "Invalid membership type" },
          { status: 400 },
        );
      }

      const { data: currentUser, error: loadError } = await gate.supabase
        .from("users")
        .select(
          "id, membership_type, membership_started_at, membership_expires_at, first_name, last_name, phone",
        )
        .eq("id", id)
        .maybeSingle();

      if (loadError || !currentUser) {
        return NextResponse.json(
          { error: loadError?.message || "User not found" },
          { status: 404 },
        );
      }

      const lifecycle = getMembershipLifecycleStatus(currentUser);
      const isActiveGold =
        currentUser.membership_type === "gold" && lifecycle === "Active";

      // Strict rule: never manually downgrade unexpired (or expiry-less) Gold.
      if (membership_type === "regular") {
        const downgradeBlock = getManualGoldDowngradeBlockReason(currentUser);
        if (downgradeBlock) {
          void writeAdminAuditLog({
            actor: gate.actor,
            action: "membership_premature_downgrade_blocked",
            module: "members",
            description: downgradeBlock,
            success: false,
            resourceType: "user",
            resourceId: id,
            beforeData: {
              membership_type: currentUser.membership_type,
              membership_expires_at: currentUser.membership_expires_at,
            },
            ...clientMetaFromRequest(request),
          });
          return NextResponse.json({ error: downgradeBlock }, { status: 409 });
        }
      }

      // Regular / expired / not-subscribed → Gold needs convert permission.
      // Renewing Active Gold, or setting Regular (expired cleanup only), needs members.membership.
      const requiredPermission =
        membership_type === "gold" && !isActiveGold
          ? ("members.convert_regular_to_gold" as const)
          : ("members.membership" as const);

      if (!actorHasPermission(gate.actor, requiredPermission)) {
        void writeAdminAuditLog({
          actor: gate.actor,
          action: "permission_denied",
          module: "members",
          description: `Permission denied for ${requiredPermission}`,
          success: false,
          resourceType: "user",
          resourceId: id,
          metadata: { permission: requiredPermission },
          ...clientMetaFromRequest(request),
        });
        return NextResponse.json(
          {
            error:
              requiredPermission === "members.convert_regular_to_gold"
                ? "Forbidden — you do not have permission to convert Regular membership to Gold."
                : "Forbidden — you do not have permission to manage memberships.",
          },
          { status: 403 },
        );
      }

      const days =
        membership_type === "gold" ? Number(membership_duration_days) : null;
      if (
        membership_type === "gold" &&
        (!Number.isInteger(days) || days! < 1 || days! > 3660)
      ) {
        return NextResponse.json(
          { error: "Membership duration must be 1–3660 days" },
          { status: 400 },
        );
      }
      const amount =
        body.membership_amount === "" || body.membership_amount == null
          ? null
          : Number(body.membership_amount);
      if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
        return NextResponse.json(
          { error: "Invalid membership amount" },
          { status: 400 },
        );
      }
      const paymentStatus = body.membership_payment_status ?? "not_recorded";
      if (!["not_recorded", "paid", "pending"].includes(paymentStatus)) {
        return NextResponse.json(
          { error: "Invalid payment status" },
          { status: 400 },
        );
      }
      const { error: membershipError } = await gate.supabase.rpc(
        "admin_set_user_membership",
        {
          p_user_id: id,
          p_membership_type: membership_type,
          p_duration_days: days,
          p_amount: amount,
          p_payment_reference:
            typeof body.membership_payment_reference === "string"
              ? body.membership_payment_reference.trim() || null
              : null,
          p_payment_status: paymentStatus,
        },
      );
      if (membershipError) {
        const rpcMessage = safeErrorMessage(
          membershipError,
          "Membership update failed.",
        );
        const premature =
          /Cannot downgrade (active )?Gold membership/i.test(rpcMessage) ||
          /before expiry/i.test(rpcMessage);
        return NextResponse.json(
          { error: rpcMessage },
          { status: premature ? 409 : 500 },
        );
      }

      const actorLabel =
        gate.actor.displayName || gate.actor.username || "admin";
      const memberName = [currentUser.first_name, currentUser.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();

      void writeAdminAuditLog({
        actor: gate.actor,
        action:
          membership_type === "gold" && !isActiveGold
            ? "membership_converted_to_gold"
            : membership_type === "gold"
              ? "membership_gold_renewed"
              : "membership_set_regular",
        module: "members",
        description:
          membership_type === "gold" && !isActiveGold
            ? `Member ${memberName || currentUser.phone || id} converted to Gold by ${actorLabel}`
            : `Member ${memberName || currentUser.phone || id} membership set to ${membership_type} by ${actorLabel}`,
        success: true,
        resourceType: "user",
        resourceId: id,
        beforeData: {
          membership_type: currentUser.membership_type,
          membership_expires_at: currentUser.membership_expires_at,
        },
        afterData: {
          membership_type,
          membership_duration_days: days,
        },
        ...clientMetaFromRequest(request),
      });
    }

    if (Object.keys(updateData).length === 0) {
      if (membership_type) return NextResponse.json({ success: true });
      return NextResponse.json(
        { error: "No updates supplied" },
        { status: 400 },
      );
    }

    const { data, error } = await gate.supabase
      .from("users")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("UPDATE USER ERROR:", error);

      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 500,
        },
      );
    }

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

    const { error } = await __adminGate.supabase
      .from("users")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("DELETE USER ERROR:", error);

      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 500,
        },
      );
    }

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
