import { requireAdminPermission } from "@/lib/admin-api";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const LIST_ERROR = "Unable to load member review reports.";

/** GET /api/admin/member-review-reports?status=open */
export async function GET(request: Request) {
  const adminGate = await requireAdminPermission("reviews.view", {
    request,
    auditModule: "reviews",
  });
  if (!adminGate.ok) return adminGate.response;

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const limit = Math.min(
      300,
      Math.max(1, Number(url.searchParams.get("limit") ?? 200) || 200),
    );

    let query = supabaseAdmin
      .from("member_review_reports")
      .select(
        `
        id,
        review_id,
        reporter_user_id,
        reason,
        status,
        created_at,
        resolved_at,
        resolved_by,
        reporter:users!member_review_reports_reporter_user_id_fkey (
          first_name,
          last_name,
          phone
        ),
        review:member_reviews!member_review_reports_review_id_fkey (
          id,
          rating,
          review_text,
          status,
          subject_user_id,
          reviewer_user_id
        )
      `,
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (
      status === "open" ||
      status === "resolved" ||
      status === "dismissed"
    ) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: LIST_ERROR }, { status: 400 });
    }

    return NextResponse.json({ ok: true, reports: data ?? [] });
  } catch {
    return NextResponse.json({ error: LIST_ERROR }, { status: 500 });
  }
}
