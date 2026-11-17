import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import {
  normalizeCategoryKey,
  parseBool,
  parseSortOrder,
} from "@/lib/help-center";
import { supabaseAdmin } from "@/lib/supabase-admin";

const CATEGORY_SELECT =
  "id, key, sort_order, is_active, created_at, updated_at";

export async function GET(request: Request) {
  const gate = await requireAdminPermission("help.view", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const activeParam = url.searchParams.get("active");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize") ?? "50") || 50),
  );
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from("help_faq_categories")
    .select(CATEGORY_SELECT, { count: "exact" })
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true })
    .range(from, to);

  if (q) {
    query = query.ilike("key", `%${q.replace(/%/g, "")}%`);
  }
  if (activeParam === "true" || activeParam === "false") {
    query = query.eq("is_active", activeParam === "true");
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const ids = (data ?? []).map((r) => r.id as string);
  const faqCounts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: faqs } = await supabaseAdmin
      .from("help_faqs")
      .select("category_id")
      .in("category_id", ids);
    for (const row of faqs ?? []) {
      const cid = String(row.category_id);
      faqCounts[cid] = (faqCounts[cid] ?? 0) + 1;
    }
  }

  const rows = (data ?? []).map((row) => ({
    ...row,
    faq_count: faqCounts[row.id as string] ?? 0,
  }));

  return NextResponse.json({
    ok: true,
    rows,
    page,
    pageSize,
    total: count ?? 0,
  });
}

export async function POST(request: Request) {
  const gate = await requireAdminPermission("help.manage", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json();
    const key = normalizeCategoryKey(body?.key);
    if (!key.ok) {
      return NextResponse.json({ ok: false, error: key.error }, { status: 400 });
    }
    const sort = parseSortOrder(body?.sort_order, 0);
    if (!sort.ok) {
      return NextResponse.json({ ok: false, error: sort.error }, { status: 400 });
    }
    const isActive = parseBool(body?.is_active, true);

    const { data, error } = await supabaseAdmin
      .from("help_faq_categories")
      .insert({
        key: key.value,
        sort_order: sort.value,
        is_active: isActive,
      })
      .select(CATEGORY_SELECT)
      .single();

    if (error) {
      const isDup = error.code === "23505" || /duplicate|unique/i.test(error.message);
      void recordFailure({
        actor: gate.actor,
        action: "help_category_created",
        module: "help",
        description: "Failed to create FAQ category",
        resourceType: "help_faq_category",
        reason: error.message,
        metadata: { key: key.value },
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json(
        {
          ok: false,
          error: isDup ? "A category with this key already exists." : error.message,
        },
        { status: isDup ? 409 : 400 },
      );
    }

    void recordSuccess({
      actor: gate.actor,
      action: "help_category_created",
      module: "help",
      description: `FAQ category ${key.value} created`,
      resourceType: "help_faq_category",
      resourceId: data?.id,
      entityLabel: key.value,
      afterData: data ?? undefined,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true, row: { ...data, faq_count: 0 } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
