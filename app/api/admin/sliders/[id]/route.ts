import { requireAdminApi } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

function normalizeMediaType(value: unknown): "image" | "video" {
  return value === "video" ? "video" : "image";
}

export async function PUT(req: NextRequest, context: Context) {
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

    const { id } = await context.params;

    const { data: before } = await supabaseAdmin
      .from("sliders")
      .select("image, status, display_order, media_type")
      .eq("id", id)
      .maybeSingle();

    const { data, error } = await supabaseAdmin
      .from("sliders")
      .update({
        image: image.trim(),
        status,
        display_order,
        media_type: normalizeMediaType(media_type),
      })
      .eq("id", id)
      .select()
      .single();

    const afterData = {
      image: image.trim(),
      status,
      display_order,
      media_type: normalizeMediaType(media_type),
    };

    if (error) {
      void recordFailure({
        actor: __adminGate.actor,
        action: "slider_updated",
        module: "sliders",
        description: `Failed to update slider ${id}`,
        resourceType: "slider",
        resourceId: id,
        reason: error.message,
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
      action: "slider_updated",
      module: "sliders",
      description: `Slider ${id} updated`,
      resourceType: "slider",
      resourceId: id,
      changedFields: Object.keys(afterData).filter(
        (key) =>
          JSON.stringify((before as Record<string, unknown> | null)?.[key] ?? null) !==
          JSON.stringify((afterData as Record<string, unknown>)[key] ?? null),
      ),
      beforeData: before ?? null,
      afterData,
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

export async function DELETE(req: NextRequest, context: Context) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const { id } = await context.params;

    const { data: before } = await supabaseAdmin
      .from("sliders")
      .select("image, status, display_order, media_type")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabaseAdmin.from("sliders").delete().eq("id", id);

    if (error) {
      void recordFailure({
        actor: __adminGate.actor,
        action: "slider_deleted",
        module: "sliders",
        description: `Failed to delete slider ${id}`,
        resourceType: "slider",
        resourceId: id,
        reason: error.message,
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
      action: "slider_deleted",
      module: "sliders",
      description: `Slider ${id} deleted`,
      resourceType: "slider",
      resourceId: id,
      beforeData: before ?? null,
      ...clientMetaFromRequest(req),
    });

    return NextResponse.json({
      success: true,
    });
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
