import { requireAdminApi } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

function normalizeMediaType(value: unknown): "image" | "video" {
  return value === "video" ? "video" : "image";
}

export async function POST(req: Request) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const body = await req.json();

    const { image, status, display_order, media_type } = body;

    if (!image || typeof image !== "string" || !image.trim()) {
      return NextResponse.json(
        {
          error: "Media URL is required",
        },
        {
          status: 400,
        },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("sliders")
      .insert({
        image: image.trim(),
        status,
        display_order,
        media_type: normalizeMediaType(media_type),
      })
      .select()
      .single();

    if (error) {
      void recordFailure({
        actor: __adminGate.actor,
        action: "slider_created",
        module: "sliders",
        description: "Failed to create slider",
        resourceType: "slider",
        reason: error.message,
        metadata: { media_type: normalizeMediaType(media_type), status, display_order },
        ...clientMetaFromRequest(req),
      });
      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 500,
        },
      );
    }

    void recordSuccess({
      actor: __adminGate.actor,
      action: "slider_created",
      module: "sliders",
      description: `Slider (${normalizeMediaType(media_type)}) created`,
      resourceType: "slider",
      resourceId: data?.id != null ? String(data.id) : undefined,
      afterData: {
        image: image.trim(),
        status,
        display_order,
        media_type: normalizeMediaType(media_type),
      },
      ...clientMetaFromRequest(req),
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Something went wrong",
      },
      {
        status: 500,
      },
    );
  }
}
