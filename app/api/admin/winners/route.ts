import { requireAdminApi } from "@/lib/admin-api";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
export async function POST(request: Request) {
  const gate = await requireAdminApi();
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
    
    const { error } = await supabaseAdmin.from("winners").insert(payload);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unable to save winner" }, { status: 500 });
  }
}
