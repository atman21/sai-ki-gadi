import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin-api";
import { ADMIN_PERMISSIONS } from "@/lib/admin-permissions";

export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const permissions = gate.actor.isSuperAdmin
    ? [...ADMIN_PERMISSIONS]
    : [...gate.actor.permissions];

  return NextResponse.json({
    ok: true,
    data: {
      id: gate.actor.id,
      username: gate.actor.username,
      displayName: gate.actor.displayName,
      isSuperAdmin: gate.actor.isSuperAdmin,
      isEnvBootstrap: gate.actor.isEnvBootstrap,
      permissions,
    },
  });
}
