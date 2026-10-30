import { NextResponse } from "next/server";

import {
  parseMemberVerificationFilter,
  parseMemberVerificationList,
} from "@/lib/admin-ops-parse";
import { callAdminOpsFunction } from "@/lib/secure-admin-backend";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

function opsError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filter = parseMemberVerificationFilter(url.searchParams.get("filter"));
  const pageRaw = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isFinite(pageRaw) ? Math.min(Math.max(Math.round(pageRaw), 1), 1000) : 1;
  const search = (url.searchParams.get("search") ?? "")
    .replace(/[\u0000-\u001F]/g, "")
    .trim()
    .slice(0, 80);

  const result = await callAdminOpsFunction("admin-member-verification", {
    action: "list",
    filter,
    search,
    page,
    page_size: PAGE_SIZE,
  });
  if (!result.ok) return opsError(result.status, result.error);

  const list = parseMemberVerificationList(result.payload, page, PAGE_SIZE);
  return NextResponse.json({ ok: true, ...list });
}
