import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { clientMetaFromRequest, recordChange, recordFailure } from "@/lib/admin-audit";

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > new Date().getFullYear() || month < 1 || month > 12) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day &&
    date.getTime() <= Date.now();
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const supabaseAdmin = gate.supabase;
  const { id } = await ctx.params;
  if (!/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(id)) return NextResponse.json({ ok: false, error: "Invalid user ID" }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  if (!validDate(body.birth_date)) return NextResponse.json({ ok: false, error: "Choose a valid date of birth" }, { status: 400 });
  const { data: before } = await supabaseAdmin.from("users").select("birth_date").eq("id", id).maybeSingle();
  const { data, error } = await supabaseAdmin.from("users").update({ birth_date: body.birth_date }).eq("id", id).select("id,birth_date").maybeSingle();
  if (error) {
    void recordFailure({
      actor: gate.actor,
      action: "user_birth_date_updated",
      module: "members",
      description: `Failed to update birth date for member ${id}`,
      resourceType: "user",
      resourceId: id,
      relatedUserId: id,
      reason: error.message,
      ...clientMetaFromRequest(req),
    });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
  void recordChange({
    actor: gate.actor,
    action: "user_birth_date_updated",
    module: "members",
    description: `Birth date updated for member ${id}`,
    resourceType: "user",
    resourceId: id,
    relatedUserId: id,
    changedFields: ["birth_date"],
    beforeData: { birth_date: before?.birth_date ?? null },
    afterData: { birth_date: data.birth_date },
    ...clientMetaFromRequest(req),
  });
  return NextResponse.json({ ok: true, user: data });
}
