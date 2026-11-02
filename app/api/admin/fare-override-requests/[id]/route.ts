import { NextResponse } from "next/server";

import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: Context) {
  const gate = await requireAdminPermission("fare_overrides.view", {
    request,
    auditModule: "fare_overrides",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const { data, error } = await gate.supabase
    .from("fare_override_requests")
    .select(
      `
      id,
      user_id,
      from_city,
      from_state,
      to_city,
      to_state,
      vehicle_category,
      normal_min_fare,
      requested_fare,
      reason,
      status,
      rejection_reason,
      reviewed_at,
      reviewed_by,
      created_at,
      updated_at,
      users!fare_override_requests_user_id_fkey (
        id,
        first_name,
        last_name,
        phone
      )
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Unable to load fare override request."),
      },
      { status: 400 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Request not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, data });
}
