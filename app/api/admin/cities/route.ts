import { requireAdminApi } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: Request) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const body = await req.json();

    const { city, state, district } = body;

    const { data, error } = await supabaseAdmin
      .from("cities")
      .insert({
        city,
        state,
        district: district || null,
      })
      .select()
      .single();

    if (error) {
      console.error(error);

      void recordFailure({
        actor: __adminGate.actor,
        action: "city_created",
        module: "cities",
        description: `Failed to create city ${city ?? ""}`.trim(),
        resourceType: "city",
        reason: error.message,
        metadata: { city, state, district: district || null },
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
      action: "city_created",
      module: "cities",
      description: `City ${city} (${state}) created`,
      resourceType: "city",
      resourceId: data?.id != null ? String(data.id) : undefined,
      entityLabel: city ?? null,
      afterData: { city, state, district: district || null },
      ...clientMetaFromRequest(req),
    });

    return NextResponse.json(data);
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
