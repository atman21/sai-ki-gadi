import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import {
  requireAdminApi,
  safeErrorMessage,
} from "@/lib/in-app-announcements/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const ALLOWED_IMAGE = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ALLOWED_AUDIO = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
]);

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const kind = String(formData.get("kind") ?? "image");

    if (!file) {
      return NextResponse.json(
        { ok: false, error: "No file uploaded" },
        { status: 400 },
      );
    }

    if (kind === "image") {
      if (!ALLOWED_IMAGE.has(file.type)) {
        return NextResponse.json(
          { ok: false, error: "Unsupported image. Use PNG, JPG, or WebP." },
          { status: 400 },
        );
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { ok: false, error: "Image must be 8 MB or smaller." },
          { status: 400 },
        );
      }
    } else if (kind === "audio") {
      if (!ALLOWED_AUDIO.has(file.type) && !file.name.match(/\.(mp3|wav|m4a|aac|ogg)$/i)) {
        return NextResponse.json(
          { ok: false, error: "Unsupported audio. Use MP3, WAV, M4A, AAC, or OGG." },
          { status: 400 },
        );
      }
      if (file.size > MAX_AUDIO_BYTES) {
        return NextResponse.json(
          { ok: false, error: "Audio must be 20 MB or smaller." },
          { status: 400 },
        );
      }
    } else {
      return NextResponse.json(
        { ok: false, error: "Invalid upload kind" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${kind}/${randomUUID()}-${safeName}`;

    const { error } = await auth.supabase.storage
      .from("announcement-assets")
      .upload(path, buffer, {
        contentType: file.type || (kind === "audio" ? "audio/mpeg" : "image/jpeg"),
        upsert: false,
      });

    const uploadMeta = {
      kind,
      fileName: safeName,
      contentType: file.type || null,
      sizeBytes: file.size,
      bucket: "announcement-assets",
    };

    if (error) {
      void recordFailure({
        actor: auth.actor,
        action: "announcement_asset_uploaded",
        module: "announcements",
        description: `Failed to upload announcement ${kind} "${safeName}"`,
        resourceType: "storage_object",
        reason: error.message,
        metadata: uploadMeta,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    const {
      data: { publicUrl },
    } = auth.supabase.storage.from("announcement-assets").getPublicUrl(path);

    void recordSuccess({
      actor: auth.actor,
      action: "announcement_asset_uploaded",
      module: "announcements",
      description: `Announcement ${kind} "${safeName}" uploaded`,
      resourceType: "storage_object",
      resourceId: path,
      metadata: uploadMeta,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true, url: publicUrl, path });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(error, "Upload failed") },
      { status: 500 },
    );
  }
}
