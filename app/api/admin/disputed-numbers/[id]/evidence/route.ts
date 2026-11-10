import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import {
  DISPUTED_ALLOWED_MIME,
  DISPUTED_EVIDENCE_BUCKET,
  DISPUTED_EVIDENCE_MAX_BYTES,
  DISPUTED_SIGNED_URL_TTL_SEC,
  detectImageKindFromBytes,
  extForImageKind,
  mimeForImageKind,
} from "@/lib/disputed-number-evidence";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Ctx = { params: Promise<{ id: string }> };

/** Short-lived signed URL for authorized Admin viewers. */
export async function GET(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("disputed_numbers.view", {
    request,
    auditModule: "disputed_numbers",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const { data: row, error } = await supabaseAdmin
    .from("disputed_numbers")
    .select("id, evidence_path")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  if (!row.evidence_path) {
    return NextResponse.json(
      { ok: false, error: "No evidence uploaded." },
      { status: 404 },
    );
  }

  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(DISPUTED_EVIDENCE_BUCKET)
    .createSignedUrl(row.evidence_path, DISPUTED_SIGNED_URL_TTL_SEC);

  if (signError || !signed?.signedUrl) {
    return NextResponse.json(
      { ok: false, error: signError?.message ?? "Unable to sign evidence URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    signedUrl: signed.signedUrl,
    expiresIn: DISPUTED_SIGNED_URL_TTL_SEC,
  });
}

/** Upload / replace private evidence. Old object removed only after DB update succeeds. */
export async function POST(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("disputed_numbers.manage", {
    request,
    auditModule: "disputed_numbers",
  });
  if (!gate.ok) return gate.response;

  try {
    const { id } = await context.params;
    const { data: row, error: loadError } = await supabaseAdmin
      .from("disputed_numbers")
      .select("id, evidence_path, mobile_number")
      .eq("id", id)
      .maybeSingle();

    if (loadError) {
      return NextResponse.json(
        { ok: false, error: loadError.message },
        { status: 500 },
      );
    }
    if (!row) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "No image file uploaded." },
        { status: 400 },
      );
    }

    if (file.size <= 0 || file.size > DISPUTED_EVIDENCE_MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Image must be between 1 byte and 5 MB." },
        { status: 400 },
      );
    }

    const declaredType = String(file.type || "");
    if (!DISPUTED_ALLOWED_MIME.has(declaredType)) {
      return NextResponse.json(
        { ok: false, error: "Only JPEG, PNG, or WebP images are allowed." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const kind = detectImageKindFromBytes(buffer);
    const detectedMime = mimeForImageKind(kind);
    const ext = extForImageKind(kind);
    if (!kind || !detectedMime || !ext || detectedMime !== declaredType) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "File content does not match a valid JPEG, PNG, or WebP image.",
        },
        { status: 400 },
      );
    }

    const objectPath = `${id}/${randomUUID()}.${ext}`;
    const previousPath =
      typeof row.evidence_path === "string" && row.evidence_path.trim()
        ? row.evidence_path.trim()
        : null;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(DISPUTED_EVIDENCE_BUCKET)
      .upload(objectPath, buffer, {
        contentType: detectedMime,
        upsert: false,
      });

    if (uploadError) {
      void recordFailure({
        actor: gate.actor,
        action: "disputed_number_evidence_uploaded",
        module: "disputed_numbers",
        description: "Failed to upload disputed evidence",
        resourceType: "disputed_number",
        resourceId: id,
        reason: uploadError.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json(
        { ok: false, error: uploadError.message },
        { status: 500 },
      );
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("disputed_numbers")
      .update({
        evidence_path: objectPath,
        updated_by: gate.actor.id ?? null,
      })
      .eq("id", id)
      .select(
        "id, mobile_number, remarks, evidence_path, created_by, updated_by, created_at, updated_at",
      )
      .single();

    if (updateError) {
      // Roll back new object; keep previous evidence_path intact.
      await supabaseAdmin.storage
        .from(DISPUTED_EVIDENCE_BUCKET)
        .remove([objectPath]);
      void recordFailure({
        actor: gate.actor,
        action: "disputed_number_evidence_uploaded",
        module: "disputed_numbers",
        description: "Failed to attach disputed evidence path",
        resourceType: "disputed_number",
        resourceId: id,
        reason: updateError.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 },
      );
    }

    if (previousPath && previousPath !== objectPath) {
      await supabaseAdmin.storage
        .from(DISPUTED_EVIDENCE_BUCKET)
        .remove([previousPath]);
    }

    void recordSuccess({
      actor: gate.actor,
      action: "disputed_number_evidence_uploaded",
      module: "disputed_numbers",
      description: `Evidence uploaded for disputed number ${row.mobile_number}`,
      resourceType: "disputed_number",
      resourceId: id,
      afterData: { evidence_path: objectPath },
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true, row: updated });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
