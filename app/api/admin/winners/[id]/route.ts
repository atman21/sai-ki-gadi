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
  return "Failed to update winner";
}

export async function PUT(
  request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const body = await request.json();

    const { id } = await context.params;
    if (typeof body.winner_text !== "string" || !body.winner_text.trim()) {
      return NextResponse.json({ success: false, error: "Winner text is required" }, { status: 400 });
    }
    if (body.winner_text.length > 5000) {
      return NextResponse.json({ success: false, error: "Winner text is too long" }, { status: 400 });
    }
    const mediaType = normalizeMediaType(body.media_type);
    const payload = {
      user_id: null,
      winner_text: typeof body.winner_text === "string" ? body.winner_text.trim() : "",
      date: body.date,
      slot: "",
      image: typeof body.image === "string" ? body.image.trim() || null : null,
      media_type: mediaType,
    };

    const { error } = await supabaseAdmin
      .from("winners")
      .update(payload)
      .eq("id", id);

    if (!error) {
      return NextResponse.json({
        success: true,
      });
    }

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

      const { error: fallbackError } = await supabaseAdmin
        .from("winners")
        .update({
          user_id: payload.user_id,
          winner_text: payload.winner_text,
          date: payload.date,
          slot: payload.slot,
          image: payload.image,
        })
        .eq("id", id);

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
          "Updated as image without media_type (column missing). Apply migration 043_winners_media_type.sql for video support.",
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
    console.error("Update winner failed:", safeDbErrorMessage(error));

    return NextResponse.json(
      {
        success: false,
        error: "Failed to update winner",
      },
      {
        status: 500,
      },
    );
  }
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const { id } = await context.params;

    const { error } = await supabaseAdmin.from("winners").delete().eq("id", id);

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: safeDbErrorMessage(error),
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Delete winner failed:", safeDbErrorMessage(error));

    return NextResponse.json(
      {
        success: false,
        error: "Failed to delete winner",
      },
      {
        status: 500,
      },
    );
  }
}
