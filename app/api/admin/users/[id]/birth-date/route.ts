import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-session";
import { serviceRoleConfigIssue, supabaseAdmin, usingServiceRole } from "@/lib/supabase-admin";

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > new Date().getFullYear() || month < 1 || month > 12) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day &&
    date.getTime() <= Date.now();
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await cookies();
  if (!hasAdminSession(session)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!usingServiceRole) return NextResponse.json({ ok: false, error: serviceRoleConfigIssue() ?? "Service role unavailable" }, { status: 503 });
  const { id } = await ctx.params;
  if (!/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(id)) return NextResponse.json({ ok: false, error: "Invalid user ID" }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  if (!validDate(body.birth_date)) return NextResponse.json({ ok: false, error: "Choose a valid date of birth" }, { status: 400 });
  const { data, error } = await supabaseAdmin.from("users").update({ birth_date: body.birth_date }).eq("id", id).select("id,birth_date").maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
  return NextResponse.json({ ok: true, user: data });
}
