import { requireAdminPermission } from "@/lib/admin-api";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const LIST_ERROR = "Unable to load member reviews.";

/**
 * GET /api/admin/member-reviews
 * Query: status, rating, q (name/text search), limit
 */
export async function GET(request: Request) {
  const adminGate = await requireAdminPermission("reviews.view", {
    request,
    auditModule: "reviews",
  });
  if (!adminGate.ok) return adminGate.response;

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const ratingRaw = url.searchParams.get("rating");
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const limit = Math.min(
      300,
      Math.max(1, Number(url.searchParams.get("limit") ?? 200) || 200),
    );

    let query = supabaseAdmin
      .from("member_reviews")
      .select(
        `
        id,
        reviewer_user_id,
        subject_user_id,
        rating,
        review_text,
        status,
        created_at,
        updated_at,
        moderated_at,
        moderated_by,
        reviewer:users!member_reviews_reviewer_user_id_fkey (
          first_name,
          last_name,
          phone
        ),
        subject:users!member_reviews_subject_user_id_fkey (
          first_name,
          last_name,
          phone
        )
      `,
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (
      status === "published" ||
      status === "hidden" ||
      status === "removed"
    ) {
      query = query.eq("status", status);
    }

    const rating = ratingRaw ? Number(ratingRaw) : null;
    if (rating && rating >= 1 && rating <= 5) {
      query = query.eq("rating", rating);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: LIST_ERROR }, { status: 400 });
    }

    let rows = data ?? [];
    if (q) {
      rows = rows.filter((row) => {
        const reviewer = Array.isArray(row.reviewer)
          ? row.reviewer[0]
          : row.reviewer;
        const subject = Array.isArray(row.subject)
          ? row.subject[0]
          : row.subject;
        const blob = [
          reviewer?.first_name,
          reviewer?.last_name,
          reviewer?.phone,
          subject?.first_name,
          subject?.last_name,
          subject?.phone,
          row.review_text,
          row.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });
    }

    return NextResponse.json({ ok: true, reviews: rows });
  } catch {
    return NextResponse.json({ error: LIST_ERROR }, { status: 500 });
  }
}
