import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { requireAdminApi } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import { hasAdminSession } from "@/lib/admin-session";
import {
  serviceRoleConfigIssue,
  supabaseAdmin,
  usingServiceRole,
} from "@/lib/supabase-admin";
import { normalizeIndianStateName } from "@/lib/normalize-indian-state";
import {
  isVehicleCategory,
  type VehicleCategory,
} from "@/lib/vehicle-categories";

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
      error: `Invalid vehicle category. Allowed: Sedan, SUV, Hatchback, etc.`,
    };
  }
  return trimmed;
}

function validateBody(body: Body):
  | {
      ok: true;
      row: {
        from_city: string;
        from_state: string;
        to_city: string;
        to_state: string;
        vehicle_category: string | null;
        minimum_fare: number;
        is_active: boolean;
      };
    }
  | { ok: false; error: string } {
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
    return { ok: false, error: vehicle.error };
  }

  if (!from_city || !from_state || !to_city || !to_state) {
    return { ok: false, error: "From/To city and state are required." };
  }
  if (
    from_city.toLowerCase() === to_city.toLowerCase() &&
    from_state.toLowerCase() === to_state.toLowerCase()
  ) {
    return {
      ok: false,
      error: "From and To cannot be the same city and state.",
    };
  }
  if (!Number.isFinite(minimum_fare) || minimum_fare <= 0) {
    return { ok: false, error: "Minimum fare must be a number greater than 0." };
  }

  return {
    ok: true,
    row: {
      from_city,
      from_state,
      to_city,
      to_state,
      vehicle_category: vehicle as string | null,
      minimum_fare,
      is_active: body.is_active !== false,
    },
  };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  if (!usingServiceRole) {
    return NextResponse.json(
      {
        ok: false,
        error:
          serviceRoleConfigIssue() ??
          "Server-only SUPABASE_SERVICE_ROLE_KEY is required.",
      },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const vehicle = (searchParams.get("vehicle") ?? "").trim();
  const status = (searchParams.get("status") ?? "").trim(); // active|inactive|all
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get("pageSize") ?? "50") || 50),
  );
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from("route_minimum_fares")
    .select(
      "id, from_city, from_state, to_city, to_state, vehicle_category, minimum_fare, is_active, created_at, updated_at",
      { count: "exact" },
    )
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  if (vehicle) query = query.ilike("vehicle_category", vehicle);

  if (q) {
    const pattern = `%${q}%`;
    query = query.or(
      `from_city.ilike.${pattern},to_city.ilike.${pattern},from_state.ilike.${pattern},to_state.ilike.${pattern}`,
    );
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
  });
}

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as Body;
  const validated = validateBody(body);
  if (!validated.ok) {
    return NextResponse.json(
      { ok: false, error: validated.error },
      { status: 400 },
    );
  }

  if (!validated.row.vehicle_category) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Vehicle category is required for new rules. Legacy route-only rules are preserved but new rules must include a vehicle.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await gate.supabase
    .from("route_minimum_fares")
    .insert(validated.row)
    .select("*")
    .single();

  const routeLabel = `${validated.row.from_city} → ${validated.row.to_city} (${validated.row.vehicle_category})`;

  if (error) {
    const msg = error.message.toLowerCase();
    void recordFailure({
      actor: gate.actor,
      action: "minimum_fare_created",
      module: "fares",
      description: `Failed to create minimum fare ${routeLabel}`,
      resourceType: "route_minimum_fare",
      entityLabel: routeLabel,
      reason: error.message,
      metadata: { ...validated.row },
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

  void recordSuccess({
    actor: gate.actor,
    action: "minimum_fare_created",
    module: "fares",
    description: `Minimum fare ${routeLabel} created at ${validated.row.minimum_fare}`,
    resourceType: "route_minimum_fare",
    resourceId: data?.id != null ? String(data.id) : undefined,
    entityLabel: routeLabel,
    afterData: { ...validated.row },
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true, data });
}
