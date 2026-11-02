import { requireAdminPermission } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import { NextResponse } from "next/server";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminPermission("winners.manage", {
    request,
    auditModule: "winners",
  });
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json();
    const date = body.date;
    const winnerText = body.winner_text;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      return NextResponse.json({ error: "Select a valid date" }, { status: 400 });
    }
    if (typeof winnerText !== "string" || !winnerText.trim() || winnerText.length > 5000) {
      return NextResponse.json({ error: "Winner text is required (maximum 5000 characters)" }, { status: 400 });
    }
    const payload = { date, winner_text: winnerText, user_id: null, slot: "", image: null, media_type: "image" };
    const { id } = await context.params;
    const { data: before } = await gate.supabase
      .from("winners")
      .select("date, winner_text")
      .eq("id", id)
      .maybeSingle();
    const { error } = await gate.supabase.from("winners").update(payload).eq("id", id);
    if (error) {
      void recordFailure({
        actor: gate.actor,
        action: "winner_updated",
        module: "winners",
        description: `Failed to update winner ${id}`,
        resourceType: "winner",
        resourceId: id,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    void recordSuccess({
      actor: gate.actor,
      action: "winner_updated",
      module: "winners",
      description: `Winner ${id} updated`,
      resourceType: "winner",
      resourceId: id,
      changedFields: [
        ...(before?.date !== date ? ["date"] : []),
        ...(before?.winner_text !== winnerText ? ["winner_text"] : []),
      ],
      beforeData: before
        ? { date: before.date, winner_text: String(before.winner_text ?? "").slice(0, 500) }
        : null,
      afterData: { date, winner_text: winnerText.slice(0, 500) },
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unable to save winner" }, { status: 500 });
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
  const gate = await requireAdminPermission("winners.manage", {
    request,
    auditModule: "winners",
  });
  if (!gate.ok) return gate.response;

  try {
    const { id } = await context.params;

    const { data: before } = await gate.supabase
      .from("winners")
      .select("date, winner_text")
      .eq("id", id)
      .maybeSingle();

    const { error } = await gate.supabase.from("winners").delete().eq("id", id);

    if (error) {
      void recordFailure({
        actor: gate.actor,
        action: "winner_deleted",
        module: "winners",
        description: `Failed to delete winner ${id}`,
        resourceType: "winner",
        resourceId: id,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        {
          status: 500,
        },
      );
    }

    void recordSuccess({
      actor: gate.actor,
      action: "winner_deleted",
      module: "winners",
      description: `Winner ${id} deleted`,
      resourceType: "winner",
      resourceId: id,
      beforeData: before
        ? { date: before.date, winner_text: String(before.winner_text ?? "").slice(0, 500) }
        : null,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error(
      "Delete winner failed:",
      error instanceof Error ? error.message : error,
    );

    return NextResponse.json(
      {
        success: false,
        error: "Failed to delete winner",
      },
      {
        status: 500,
      },
    );
  }
}
