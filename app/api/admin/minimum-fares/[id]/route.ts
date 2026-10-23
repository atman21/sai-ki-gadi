import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordChange,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import { normalizeIndianStateName } from "@/lib/normalize-indian-state";
import {
  isVehicleCategory,
  type VehicleCategory,
} from "@/lib/vehicle-categories";

type Context = {
  params: Promise<{ id: string }>;
};

type Body = {
  from_city?: string;
  from_state?: string;
  to_city?: string;
  to_state?: string;
  vehicle_category?: string | null;
  minimum_fare?: number | string;
  is_active?: boolean;
};

function normalizePart(value: string): string {
  return value.trim();
}

function normalizeVehicleCategory(
  raw: string | null | undefined,
): VehicleCategory | null | { error: string } {
  if (raw == null || String(raw).trim() === "") {
    return null;
  }
  const trimmed = String(raw).trim();
  if (!isVehicleCategory(trimmed)) {
    return {
      error: `Invalid vehicle category.`,
    };
  }
  return trimmed;
}

export async function PUT(request: Request, context: Context) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Body;

  const from_city = normalizePart(body.from_city ?? "");
  const from_state = normalizeIndianStateName(
    normalizePart(body.from_state ?? ""),
  );
  const to_city = normalizePart(body.to_city ?? "");
  const to_state = normalizeIndianStateName(normalizePart(body.to_state ?? ""));
  const fareRaw = body.minimum_fare;
  const minimum_fare =
    typeof fareRaw === "number" ? fareRaw : Number(String(fareRaw ?? "").trim());
  const vehicle = normalizeVehicleCategory(body.vehicle_category);

  if (vehicle && typeof vehicle === "object" && "error" in vehicle) {
    return NextResponse.json(
      { ok: false, error: vehicle.error },
      { status: 400 },
    );
  }

  if (!from_city || !from_state || !to_city || !to_state) {
    return NextResponse.json(
      { ok: false, error: "From/To city and state are required." },
      { status: 400 },
    );
  }
  if (
    from_city.toLowerCase() === to_city.toLowerCase() &&
    from_state.toLowerCase() === to_state.toLowerCase()
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "From and To cannot be the same city and state.",
      },
      { status: 400 },
    );
  }
  if (!Number.isFinite(minimum_fare) || minimum_fare <= 0) {
    return NextResponse.json(
      { ok: false, error: "Minimum fare must be a number greater than 0." },
      { status: 400 },
    );
  }

  const { data: before } = await gate.supabase
    .from("route_minimum_fares")
    .select("from_city, from_state, to_city, to_state, vehicle_category, minimum_fare, is_active")
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await gate.supabase
    .from("route_minimum_fares")
    .update({
      from_city,
      from_state,
      to_city,
      to_state,
      vehicle_category: vehicle as string | null,
      minimum_fare,
      is_active: body.is_active !== false,
    })
    .eq("id", id)
    .select("*")
    .single();

  const afterData = {
    from_city,
    from_state,
    to_city,
    to_state,
    vehicle_category: vehicle as string | null,
    minimum_fare,
    is_active: body.is_active !== false,
  };
  const routeLabel = `${from_city} → ${to_city} (${vehicle ?? "any vehicle"})`;

  if (error) {
    const msg = error.message.toLowerCase();
    void recordFailure({
      actor: gate.actor,
      action: "minimum_fare_updated",
      module: "fares",
      description: `Failed to update minimum fare ${routeLabel}`,
      resourceType: "route_minimum_fare",
      resourceId: id,
      entityLabel: routeLabel,
      reason: error.message,
      metadata: afterData,
      ...clientMetaFromRequest(request),
    });
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "A rule already exists for this From City, To City, and Vehicle Category.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  void recordChange({
    actor: gate.actor,
    action: "minimum_fare_updated",
    module: "fares",
    description: `Minimum fare ${routeLabel} updated`,
    resourceType: "route_minimum_fare",
    resourceId: id,
    entityLabel: routeLabel,
    changedFields: Object.keys(afterData).filter(
      (key) =>
        JSON.stringify((before as Record<string, unknown> | null)?.[key] ?? null) !==
        JSON.stringify((afterData as Record<string, unknown>)[key] ?? null),
    ),
    beforeData: before ?? null,
    afterData,
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true, data });
}

export async function PATCH(request: Request, context: Context) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    is_active?: boolean;
  };

  if (typeof body.is_active !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "is_active boolean is required." },
      { status: 400 },
    );
  }

  const { data: before } = await gate.supabase
    .from("route_minimum_fares")
    .select("from_city, to_city, vehicle_category, is_active")
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await gate.supabase
    .from("route_minimum_fares")
    .update({ is_active: body.is_active })
    .eq("id", id)
    .select("*")
    .single();

  const toggleLabel = before
    ? `${before.from_city} → ${before.to_city} (${before.vehicle_category ?? "any vehicle"})`
    : id;

  if (error) {
    void recordFailure({
      actor: gate.actor,
      action: "minimum_fare_toggled",
      module: "fares",
      description: `Failed to ${body.is_active ? "activate" : "deactivate"} minimum fare ${toggleLabel}`,
      resourceType: "route_minimum_fare",
      resourceId: id,
      entityLabel: toggleLabel,
      reason: error.message,
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  void recordChange({
    actor: gate.actor,
    action: "minimum_fare_toggled",
    module: "fares",
    description: `Minimum fare ${toggleLabel} ${body.is_active ? "activated" : "deactivated"}`,
    resourceType: "route_minimum_fare",
    resourceId: id,
    entityLabel: toggleLabel,
    changedFields: ["is_active"],
    beforeData: { is_active: before?.is_active ?? null },
    afterData: { is_active: body.is_active },
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true, data });
}

export async function DELETE(request: Request, context: Context) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const { data: before } = await gate.supabase
    .from("route_minimum_fares")
    .select("from_city, from_state, to_city, to_state, vehicle_category, minimum_fare, is_active")
    .eq("id", id)
    .maybeSingle();

  const { error } = await gate.supabase
    .from("route_minimum_fares")
    .delete()
    .eq("id", id);

  const deleteLabel = before
    ? `${before.from_city} → ${before.to_city} (${before.vehicle_category ?? "any vehicle"})`
    : id;

  if (error) {
    void recordFailure({
      actor: gate.actor,
      action: "minimum_fare_deleted",
      module: "fares",
      description: `Failed to delete minimum fare ${deleteLabel}`,
      resourceType: "route_minimum_fare",
      resourceId: id,
      entityLabel: deleteLabel,
      reason: error.message,
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  void recordSuccess({
    actor: gate.actor,
    action: "minimum_fare_deleted",
    module: "fares",
    description: `Minimum fare ${deleteLabel} deleted`,
    resourceType: "route_minimum_fare",
    resourceId: id,
    entityLabel: deleteLabel,
    beforeData: before ?? null,
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true });
}
