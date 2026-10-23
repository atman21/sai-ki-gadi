import { requireAdminApi } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const { id } = await context.params;

    const { data: before } = await supabaseAdmin
      .from("cities")
      .select("city, state, district")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabaseAdmin.from("cities").delete().eq("id", id);

    if (error) {
      console.error(error);

      void recordFailure({
        actor: __adminGate.actor,
        action: "city_deleted",
        module: "cities",
        description: `Failed to delete city ${before?.city ?? id}`,
        resourceType: "city",
        resourceId: id,
        entityLabel: before?.city ?? null,
        reason: error.message,
        ...clientMetaFromRequest(request),
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
      action: "city_deleted",
      module: "cities",
      description: `City ${before?.city ?? id} deleted`,
      resourceType: "city",
      resourceId: id,
      entityLabel: before?.city ?? null,
      beforeData: before ?? null,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Internal server error",
      },
      {
        status: 500,
      },
    );
  }
}
