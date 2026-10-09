import { requireAdminApi } from "@/lib/admin-api";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

function normalizeMediaType(value: unknown): "image" | "video" {
  return value === "video" ? "video" : "image";
}

function isMissingMediaTypeColumn(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("media_type") &&
    (message.includes("does not exist") || message.includes("could not find"))
  );
}

function safeDbErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Failed to create winner";
}

export async function POST(request: Request) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const body = await request.json();

    if (!body.user_id || typeof body.user_id !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Winner user is required",
        },
        {
          status: 400,
        },
      );
    }

    if (!body.date || typeof body.date !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Winner date is required",
        },
        {
          status: 400,
        },
      );
    }

    const mediaType = normalizeMediaType(body.media_type);
    const payload = {
      user_id: body.user_id,
      date: body.date,
      slot: body.slot ?? "",
      image: typeof body.image === "string" ? body.image.trim() || null : null,
      city: typeof body.city === "string" ? body.city.trim().slice(0,120) || null : null,
      media_type: mediaType,
    };

    const { error } = await supabaseAdmin.from("winners").insert(payload);

    if (!error) {
      return NextResponse.json({
        success: true,
      });
    }

    // Live DB may not have migration 043 yet (media_type column).
    if (isMissingMediaTypeColumn(error)) {
      if (mediaType === "video") {
        return NextResponse.json(
          {
            success: false,
            error:
              "Winner video requires the winners.media_type column. Apply migration 043_winners_media_type.sql, then retry.",
            code: "MISSING_MEDIA_TYPE_COLUMN",
          },
          {
            status: 503,
          },
        );
      }

      // Keep existing image winners working before the migration is applied.
      const { error: fallbackError } = await supabaseAdmin
        .from("winners")
        .insert({
          user_id: payload.user_id,
          date: payload.date,
          slot: payload.slot,
          image: payload.image,
        });

      if (fallbackError) {
        return NextResponse.json(
          {
            success: false,
            error: safeDbErrorMessage(fallbackError),
          },
          {
            status: 500,
          },
        );
      }

      return NextResponse.json({
        success: true,
        warning:
          "Saved as image without media_type (column missing). Apply migration 043_winners_media_type.sql for video support.",
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: safeDbErrorMessage(error),
      },
      {
        status: 500,
      },
    );
  } catch (error) {
    console.error("Create winner failed:", safeDbErrorMessage(error));

    return NextResponse.json(
      {
        success: false,
        error: "Failed to create winner",
      },
      {
        status: 500,
      },
    );
  }
}
