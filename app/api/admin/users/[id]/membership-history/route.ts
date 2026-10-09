import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  const { data, error } = await supabaseAdmin.from("membership_history")
    .select("id,membership_type,duration_days,starts_at,expires_at,amount,payment_reference,payment_status,source,status,created_at")
    .eq("user_id", id).order("created_at", { ascending: false }).limit(250);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ history: data ?? [] });
}
