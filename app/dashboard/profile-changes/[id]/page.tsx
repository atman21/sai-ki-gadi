import Link from "next/link";
import { notFound } from "next/navigation";

import { PhoneNumberAction } from "@/components/admin/phone-number-action";
import { formatDateTime } from "@/lib/format-datetime";
import {
  serviceRoleConfigIssue,
  supabaseAdmin,
  usingServiceRole,
} from "@/lib/supabase-admin";

import { ProfileChangeActions } from "./profile-change-actions";

const PHONE_CHANGE_FIELDS = new Set([
  "phone",
  "reference_phone",
  "reference_1_mobile",
  "reference_2_mobile",
]);

export const dynamic = "force-dynamic";

type ChangeEntry = {
  field?: string;
  old_value?: string;
  new_value?: string;
};

type RequestRow = {
  id: string;
  user_id: string;
  status: string;
  requested_changes: ChangeEntry[] | null;
  rejection_reason: string | null;
  requested_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  users: {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
};

const FIELD_LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  business_name: "Business name",
  business_description: "Business description",
  email: "Email",
  address_line_1: "Address line 1",
  address_line_2: "Address line 2",
  city: "City",
  state: "State",
  pincode: "Pincode",
  blood_group: "Blood group",
  birth_date: "Birth date",
  reference_1_name: "Reference 1 name",
  reference_1_mobile: "Reference 1 mobile",
  reference_2_name: "Reference 2 name",
  reference_2_mobile: "Reference 2 mobile",
  user_roles: "Roles",
  preferred_city: "Preferred city",
  experience_years: "Driving experience (years)",
  vehicle_experience: "Vehicle experience",
};

function userDisplayName(row: RequestRow): string {
  const u = row.users;
  const name = `${u?.first_name ?? ""} ${u?.last_name ?? ""}`.trim();
  return name || u?.email || row.user_id;
}

export default async function ProfileChangeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!usingServiceRole) {
    return (
      <div className="min-h-screen bg-slate-100">
        <main className="mx-auto w-full max-w-3xl px-6 py-10">
          <Link
            href="/dashboard?tab=profile-changes"
            className="mb-6 inline-block text-sm font-semibold text-indigo-600 hover:underline"
          >
            ← Back to Profile Changes
          </Link>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            <p className="font-semibold">Admin cannot bypass RLS</p>
            <p className="mt-2">
              {serviceRoleConfigIssue() ??
                "Set server-only SUPABASE_SERVICE_ROLE_KEY for the development project."}
            </p>
          </div>
        </main>
      </div>
    );
  }

  const { data, error } = await supabaseAdmin
    .from("profile_change_requests")
    .select(
      `
      id,
      user_id,
      status,
      requested_changes,
      rejection_reason,
      requested_at,
      reviewed_at,
      reviewed_by,
      users!profile_change_requests_user_id_fkey (
        first_name,
        last_name,
        phone,
        email
      )
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="min-h-screen bg-slate-100">
        <main className="mx-auto w-full max-w-3xl px-6 py-10">
          <Link
            href="/dashboard?tab=profile-changes"
            className="mb-6 inline-block text-sm font-semibold text-indigo-600 hover:underline"
          >
            ← Back to Profile Changes
          </Link>
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
            Could not load request: {error.message}
          </div>
        </main>
      </div>
    );
  }

  if (!data) {
    notFound();
  }

  const row = data as unknown as RequestRow;
  const changes = Array.isArray(row.requested_changes)
    ? row.requested_changes
    : [];

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <Link
          href="/dashboard?tab=profile-changes"
          className="mb-6 inline-block text-sm font-semibold text-indigo-600 hover:underline"
        >
          ← Back to Profile Changes
        </Link>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">
            Profile Change Request
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-slate-600">
            <span>{userDisplayName(row)}</span>
            {row.users?.phone ? (
              <>
                <span aria-hidden>·</span>
                <PhoneNumberAction phone={row.users.phone} />
              </>
            ) : null}
          </p>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd className="font-semibold capitalize text-slate-900">
                {row.status}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Requested</dt>
              <dd className="font-semibold text-slate-900">
                {formatDateTime(row.requested_at)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Reviewed</dt>
              <dd className="font-semibold text-slate-900">
                {formatDateTime(row.reviewed_at)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Reviewed by</dt>
              <dd className="font-semibold text-slate-900">
                {row.reviewed_by || "—"}
              </dd>
            </div>
          </dl>

          {row.rejection_reason ? (
            <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              Rejection reason: {row.rejection_reason}
            </p>
          ) : null}

          <div className="mt-6 space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Field changes
            </h2>
            {changes.length === 0 ? (
              <p className="text-sm text-slate-500">No field changes.</p>
            ) : (
              changes.map((change, index) => {
                const field = change.field ?? `field-${index}`;
                return (
                  <div
                    key={`${field}-${index}`}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <p className="text-sm font-bold text-slate-900">
                      {FIELD_LABELS[field] ?? field}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Old:{" "}
                      {PHONE_CHANGE_FIELDS.has(field) ? (
                        <PhoneNumberAction
                          phone={change.old_value}
                          emptyLabel="—"
                        />
                      ) : (
                        change.old_value || "—"
                      )}
                    </p>
                    <p className="text-sm font-semibold text-indigo-700">
                      New:{" "}
                      {PHONE_CHANGE_FIELDS.has(field) ? (
                        <PhoneNumberAction
                          phone={change.new_value}
                          emptyLabel="—"
                        />
                      ) : (
                        change.new_value || "—"
                      )}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-8">
            <ProfileChangeActions requestId={row.id} status={row.status} />
          </div>
        </div>
      </main>
    </div>
  );
}
