import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/in-app-announcements/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { data: source, error } = await auth.supabase
    .from("in_app_announcements")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !source) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Announcement not found" },
      { status: 404 },
    );
  }

  const {
    id: _id,
    created_at: _c,
    updated_at: _u,
    published_at: _p,
    archived_at: _a,
    ...rest
  } = source;

  const { data, error: insertError } = await auth.supabase
    .from("in_app_announcements")
    .insert({
      ...rest,
      internal_name: `${source.internal_name} (Copy)`,
      status: "draft",
      published_at: null,
      archived_at: null,
    })
    .select("*")
    .single();

  if (insertError) {
    void recordFailure({
      actor: auth.actor,
      action: "announcement_duplicated",
      module: "announcements",
      description: `Failed to duplicate in-app popup "${source.internal_name}"`,
      resourceType: "in_app_announcement",
      resourceId: id,
      entityLabel: source.internal_name,
      reason: insertError.message,
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json(
      { ok: false, error: insertError.message },
      { status: 400 },
    );
  }

  void recordSuccess({
    actor: auth.actor,
    action: "announcement_duplicated",
    module: "announcements",
    description: `In-app popup "${source.internal_name}" duplicated`,
    resourceType: "in_app_announcement",
    resourceId: data?.id != null ? String(data.id) : undefined,
    entityLabel: data?.internal_name ?? `${source.internal_name} (Copy)`,
    metadata: { sourceAnnouncementId: id },
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true, item: data });
}
