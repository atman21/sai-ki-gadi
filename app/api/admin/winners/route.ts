import { requireAdminPermission } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import { resolveOptionalWinnerUserId } from "@/lib/admin-winner-user-link";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const gate = await requireAdminPermission("winners.manage", {
    request,
    auditModule: "winners",
  });
  if (!gate.ok) return gate.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const date = body.date;
    const winnerText = body.winner_text;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      return NextResponse.json({ error: "Select a valid date" }, { status: 400 });
    }
    if (typeof winnerText !== "string" || !winnerText.trim() || winnerText.length > 5000) {
      return NextResponse.json({ error: "Winner text is required (maximum 5000 characters)" }, { status: 400 });
    }

    // Text-only by default. Persist user_id only when an explicit valid member id is supplied.
    const link = resolveOptionalWinnerUserId(body);
    if (!link.ok) {
      return NextResponse.json({ error: link.error }, { status: 400 });
    }

    let userId: string | null = null;
    if (link.provided && link.userId) {
      const { data: member, error: memberError } = await gate.supabase
        .from("users")
        .select("id")
        .eq("id", link.userId)
        .maybeSingle();
      if (memberError) {
        return NextResponse.json({ error: memberError.message }, { status: 500 });
      }
      if (!member) {
        return NextResponse.json({ error: "Linked member not found." }, { status: 400 });
      }
      userId = link.userId;
    }

    const payload = {
      date,
      winner_text: winnerText,
      user_id: userId,
      slot: "",
      image: null,
      media_type: "image",
    };

    const { data, error } = await gate.supabase
      .from("winners")
      .insert(payload)
      .select("id, date, user_id, winner_text")
      .single();

    if (error) {
      void recordFailure({
        actor: gate.actor,
        action: "winner_created",
        module: "winners",
        description: `Failed to add winner for ${date}`,
        resourceType: "winner",
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    void recordSuccess({
      actor: gate.actor,
      action: "winner_created",
      module: "winners",
      description: `Winner added for ${date}`,
      resourceType: "winner",
      resourceId: data?.id ?? null,
      relatedUserId: userId,
      afterData: {
        date,
        winner_text: winnerText.slice(0, 500),
        user_id: userId,
        id: data?.id ?? null,
      },
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json({
      success: true,
      winner: data
        ? {
            id: data.id,
            date: data.date,
            user_id: data.user_id ?? null,
            winner_text: data.winner_text,
          }
        : null,
    });
  } catch {
    return NextResponse.json({ error: "Unable to save winner" }, { status: 500 });
  }
}
