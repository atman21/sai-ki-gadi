import { requireAdminApi } from "@/lib/admin-api";
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
      if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 500 });
    }

    if (Object.keys(updateData).length === 0) {
      if (membership_type) return NextResponse.json({ success: true });
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

    const { error } = await supabaseAdmin.from("users").delete().eq("id", id);

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
