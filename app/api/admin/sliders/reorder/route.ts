import { requireAdminApi } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function PUT(request: Request) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const { sliders } = await request.json();

    for (const slider of sliders) {
      const { error } = await supabaseAdmin
        .from("sliders")
        .update({
          display_order: slider.display_order,
        })
        .eq("id", slider.id);

      if (error) {
        void recordFailure({
          actor: __adminGate.actor,
          action: "sliders_reordered",
          module: "sliders",
          description: "Failed to reorder sliders",
          resourceType: "slider",
          reason: error.message,
          metadata: { sliderCount: sliders.length, failedSliderId: slider.id },
          ...clientMetaFromRequest(request),
        });
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    void recordSuccess({
      actor: __adminGate.actor,
      action: "sliders_reordered",
      module: "sliders",
      description: `Reordered ${sliders.length} slider(s)`,
      resourceType: "slider",
      metadata: {
        sliderCount: sliders.length,
        order: sliders.map((slider: { id: unknown; display_order: unknown }) => ({
          id: slider.id,
          display_order: slider.display_order,
        })),
      },
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error(error);

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
