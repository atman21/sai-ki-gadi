import { requireAdminPermission } from "@/lib/admin-api";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const __adminGate = await requireAdminPermission("members.view", {
    auditModule: "members",
  });
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const { data } = await supabaseAdmin
      .from("users")
      .select(
        "id, first_name, last_name, phone",
      );

    const users =
      data?.map((user) => ({
        id: user.id,
        fullName:
          `${user.first_name ?? ""} ${
            user.last_name ?? ""
          }`.trim(),
        phone: user.phone ?? "",
      })) ?? [];

    return NextResponse.json({
      users,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json({
      users: [],
    });
  }
}