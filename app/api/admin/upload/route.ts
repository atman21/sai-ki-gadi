import { requireAdminApi } from "@/lib/admin-api";
import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import { supabaseAdmin } from "@/lib/supabase-admin";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

function normalizeMediaKind(value: FormDataEntryValue | null): "image" | "video" {
  return value === "video" ? "video" : "image";
}

export async function POST(request: Request) {
  const __adminGate = await requireAdminApi();
  if (!__adminGate.ok) return __adminGate.response;

  try {
    const formData = await request.formData();

    const file = formData.get("file") as File | null;
    const mediaKind = normalizeMediaKind(formData.get("mediaKind"));

    if (!file) {
      return NextResponse.json(
        {
          error: "No file uploaded",
        },
        {
          status: 400,
        },
      );
    }

    const allowedTypes =
      mediaKind === "video" ? ALLOWED_VIDEO_TYPES : ALLOWED_IMAGE_TYPES;
    const maxBytes = mediaKind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

    if (!allowedTypes.has(file.type)) {
      return NextResponse.json(
        {
          error:
            mediaKind === "video"
              ? "Unsupported video format. Use MP4, MOV, or WebM."
              : "Unsupported image format. Use JPG, PNG, WebP, or GIF.",
        },
        {
          status: 400,
        },
      );
    }

    if (file.size > maxBytes) {
      const limitMb = Math.round(maxBytes / (1024 * 1024));
      return NextResponse.json(
        {
          error: `File is too large. Maximum size is ${limitMb} MB.`,
        },
        {
          status: 400,
        },
      );
    }

    const bytes = await file.arrayBuffer();

    const buffer = Buffer.from(bytes);

    const fileName = `${randomUUID()}-${file.name}`;

    const { error } = await supabaseAdmin.storage
      .from("winner-images")
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      });

    const uploadMeta = {
      bucket: "winner-images",
      mediaKind,
      originalName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    };

    if (error) {
      void recordFailure({
        actor: __adminGate.actor,
        action: "media_uploaded",
        module: "uploads",
        description: `Failed to upload ${mediaKind} "${file.name}"`,
        resourceType: "storage_object",
        reason: error.message,
        metadata: uploadMeta,
        ...clientMetaFromRequest(request),
      });
      console.error("Admin upload storage error:", {
        bucket: "winner-images",
        mediaKind,
        contentType: file.type,
        message: error.message,
      });
      return NextResponse.json(
        {
          error: error.message || "Upload failed",
        },
        {
          status: 500,
        },
      );
    }

    const {
      data: { publicUrl },
    } = supabaseAdmin.storage
      .from("winner-images")
      .getPublicUrl(fileName);

    void recordSuccess({
      actor: __adminGate.actor,
      action: "media_uploaded",
      module: "uploads",
      description: `${mediaKind === "video" ? "Video" : "Image"} "${file.name}" uploaded`,
      resourceType: "storage_object",
      resourceId: fileName,
      metadata: uploadMeta,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({
      url: publicUrl,
    });
  } catch (error) {
    console.error(error);

    const message =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : "Upload failed";

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}
