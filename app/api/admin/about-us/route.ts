import { requireAdminApi } from "@/lib/admin-api";
import { clientMetaFromRequest, recordChange, recordFailure } from "@/lib/admin-audit";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

export type AboutUsContentRow = {
  id: string;
  language_code: string;
  title: string;
  description: string;
  mission: string;
  vision: string;
  offerings: string;
  closing: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const SUPPORTED_LANGUAGE_CODES = ["en", "hi", "gu", "mr", "kn"] as const;

const SELECT_COLUMNS =
  "id, language_code, title, description, mission, vision, offerings, closing, is_active, created_at, updated_at";

function isSupportedLanguageCode(value: unknown): value is (typeof SUPPORTED_LANGUAGE_CODES)[number] {
  return (
    typeof value === "string" &&
    SUPPORTED_LANGUAGE_CODES.includes(value as (typeof SUPPORTED_LANGUAGE_CODES)[number])
  );
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(req: Request) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const { searchParams } = new URL(req.url);
    const languageCode = searchParams.get("language_code");

    if (languageCode) {
      if (!isSupportedLanguageCode(languageCode)) {
        return NextResponse.json(
          { error: "Invalid language_code." },
          { status: 400 },
        );
      }

      const { data, error } = await supabaseAdmin
        .from("about_us_content")
        .select(SELECT_COLUMNS)
        .eq("language_code", languageCode)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ item: (data as AboutUsContentRow | null) ?? null });
    }

    const { data, error } = await supabaseAdmin
      .from("about_us_content")
      .select(SELECT_COLUMNS)
      .order("language_code", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ items: (data ?? []) as AboutUsContentRow[] });
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
    const languageCode = body.language_code;

    if (!isSupportedLanguageCode(languageCode)) {
      return NextResponse.json(
        { error: "language_code must be one of: en, hi, gu, mr, kn." },
        { status: 400 },
      );
    }

    const title = normalizeText(body.title);
    const description = normalizeText(body.description);
    const mission = normalizeText(body.mission);
    const vision = normalizeText(body.vision);
    const offerings = normalizeText(body.offerings);
    const closing = normalizeText(body.closing);
    const isActive = body.is_active !== false;

    if (!title && !description && !mission && !vision && !offerings && !closing) {
      return NextResponse.json(
        { error: "At least one content field must be provided." },
        { status: 400 },
      );
    }

    const { data: before } = await supabaseAdmin
      .from("about_us_content")
      .select(SELECT_COLUMNS)
      .eq("language_code", languageCode)
      .maybeSingle();

    const { data, error } = await supabaseAdmin
      .from("about_us_content")
      .upsert(
        {
          language_code: languageCode,
          title,
          description,
          mission,
          vision,
          offerings,
          closing,
          is_active: isActive,
        },
        { onConflict: "language_code" },
      )
      .select(SELECT_COLUMNS)
      .single();

    if (error) {
      void recordFailure({
        actor: __adminGate.actor,
        action: "about_us_updated",
        module: "content",
        description: `Failed to update About Us (${languageCode})`,
        resourceType: "about_us_content",
        resourceId: languageCode,
        reason: error.message,
        ...clientMetaFromRequest(req),
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const aboutFields = [
      "title",
      "description",
      "mission",
      "vision",
      "offerings",
      "closing",
      "is_active",
    ] as const;
    const beforeRow = (before ?? null) as Record<string, unknown> | null;
    const afterRow = data as unknown as Record<string, unknown>;
    const changedFields = aboutFields.filter(
      (key) => (beforeRow?.[key] ?? null) !== (afterRow[key] ?? null),
    );
    const pick = (row: Record<string, unknown> | null) =>
      row
        ? Object.fromEntries(
            aboutFields.map((key) => [
              key,
              typeof row[key] === "string"
                ? String(row[key]).slice(0, 300)
                : row[key],
            ]),
          )
        : null;
    void recordChange({
      actor: __adminGate.actor,
      action: "about_us_updated",
      module: "content",
      description: `About Us content updated (${languageCode})`,
      resourceType: "about_us_content",
      resourceId: (data as AboutUsContentRow).id ?? languageCode,
      entityLabel: languageCode,
      changedFields: [...changedFields],
      beforeData: pick(beforeRow),
      afterData: pick(afterRow),
      metadata: { language_code: languageCode, isNewRow: !before },
      ...clientMetaFromRequest(req),
    });

    return NextResponse.json(data as AboutUsContentRow);
  } catch {
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 },
    );
  }
}
