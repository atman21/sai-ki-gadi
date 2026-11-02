import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { requireAdminPermission } from "@/lib/in-app-announcements/admin-api";

export async function GET() {
  const auth = await requireAdminPermission("announcements.view", {
    auditModule: "announcements",
  });
  if (!auth.ok) return auth.response;

  try {
    const registryPath = join(
      process.cwd(),
      "lib/in-app-announcements/screen-registry.json",
    );
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    return NextResponse.json({ ok: true, registry });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Screen registry unavailable. Run announcements:sync-screens in the mobile repo.",
      },
      { status: 503 },
    );
  }
}
