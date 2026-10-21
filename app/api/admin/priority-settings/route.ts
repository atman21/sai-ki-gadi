import { requireAdminApi } from "@/lib/admin-api";
import { NextResponse } from "next/server";

import { buildPrioritySettingsUpdate } from "@/lib/booking-priority-settings";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** Legacy column names: all_platinum=Diamond, all_gold=Gold. matching_platinum is stored but ignored for booking access. */
export type RequirementPrioritySettings = {
  id: number;
  matching_platinum_minutes: number;
  all_platinum_minutes: number;
  all_gold_minutes: number;
  updated_at: string;
};

export async function GET() {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const { data, error } = await supabaseAdmin
      .from("requirement_priority_settings")
      .select(
        "id, matching_platinum_minutes, all_platinum_minutes, all_gold_minutes, updated_at",
      )
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json(
        {
          error:
            "Priority settings row not found. Apply migration 027_requirement_priority_settings.sql.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json(data as RequirementPrioritySettings);
  } catch {
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const body = await req.json();

    const platinum = Number(body.all_platinum_minutes);
    const gold = Number(body.all_gold_minutes);

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("requirement_priority_settings")
      .select("matching_platinum_minutes")
      .eq("id", 1)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (!existing) {
      return NextResponse.json(
        {
          error:
            "Priority settings row not found. Apply migration 027_requirement_priority_settings.sql.",
        },
        { status: 404 },
      );
    }

    const update = buildPrioritySettingsUpdate({
      diamondMinutes: platinum,
      goldMinutes: gold,
      existingLegacySilverMinutes: existing.matching_platinum_minutes,
    });
    if (!update.ok) {
      return NextResponse.json({ error: update.error }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("requirement_priority_settings")
      .update({
        all_platinum_minutes: update.row.all_platinum_minutes,
        all_gold_minutes: update.row.all_gold_minutes,
        matching_platinum_minutes: update.row.matching_platinum_minutes,
      })
      .eq("id", 1)
      .select(
        "id, matching_platinum_minutes, all_platinum_minutes, all_gold_minutes, updated_at",
      )
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 },
    );
  }
}
