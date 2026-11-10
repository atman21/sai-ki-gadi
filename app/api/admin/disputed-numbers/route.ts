import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import { validateRemarks } from "@/lib/disputed-number-evidence";
import {
  isValidDisputedMobile,
  normalizeIndianMobileForReference,
} from "@/lib/normalize-indian-mobile";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const gate = await requireAdminPermission("disputed_numbers.view", {
    request,
    auditModule: "disputed_numbers",
  });
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize") ?? "20") || 20),
  );
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from("disputed_numbers")
    .select(
      "id, mobile_number, remarks, evidence_path, created_by, updated_by, created_at, updated_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (q) {
    const digits = normalizeIndianMobileForReference(q) ?? q.replace(/\D/g, "");
    if (digits) {
      query = query.or(
        `mobile_number.ilike.%${digits}%,remarks.ilike.%${q.replace(/%/g, "")}%`,
      );
    } else {
      query = query.ilike("remarks", `%${q}%`);
    }
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    rows: data ?? [],
    page,
    pageSize,
    total: count ?? 0,
  });
}

export async function POST(request: Request) {
  const gate = await requireAdminPermission("disputed_numbers.manage", {
    request,
    auditModule: "disputed_numbers",
  });
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json();
    const normalized = normalizeIndianMobileForReference(body?.mobile_number);
    if (!isValidDisputedMobile(normalized)) {
      return NextResponse.json(
        { ok: false, error: "Enter a valid 10-digit Indian mobile number." },
        { status: 400 },
      );
    }
    const remarks = validateRemarks(body?.remarks);
    if (!remarks.ok) {
      return NextResponse.json({ ok: false, error: remarks.error }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("disputed_numbers")
      .insert({
        mobile_number: normalized,
        remarks: remarks.value,
        created_by: gate.actor.id ?? null,
        updated_by: gate.actor.id ?? null,
      })
      .select(
        "id, mobile_number, remarks, evidence_path, created_by, updated_by, created_at, updated_at",
      )
      .single();

    if (error) {
      const isDup =
        error.code === "23505" ||
        /duplicate|unique/i.test(error.message);
      void recordFailure({
        actor: gate.actor,
        action: "disputed_number_created",
        module: "disputed_numbers",
        description: "Failed to create disputed number",
        resourceType: "disputed_number",
        reason: error.message,
        metadata: { mobile_number: normalized },
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json(
        {
          ok: false,
          error: isDup
            ? "This mobile number is already in the disputed list."
            : error.message,
        },
        { status: isDup ? 409 : 400 },
      );
    }

    void recordSuccess({
      actor: gate.actor,
      action: "disputed_number_created",
      module: "disputed_numbers",
      description: `Disputed number ${normalized} added`,
      resourceType: "disputed_number",
      resourceId: data?.id,
      afterData: { mobile_number: normalized, remarks: remarks.value },
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true, row: data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
