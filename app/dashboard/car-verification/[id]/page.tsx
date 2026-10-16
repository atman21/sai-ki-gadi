import Link from "next/link";
import { notFound } from "next/navigation";

import { PhoneNumberAction } from "@/components/admin/phone-number-action";
import { formatDateTime } from "@/lib/format-datetime";
import {
  serviceRoleConfigIssue,
  supabaseAdmin,
  usingServiceRole,
} from "@/lib/supabase-admin";

import { VehicleVerificationActions } from "./vehicle-verification-actions";

export const dynamic = "force-dynamic";

const VEHICLE_BUCKET = "vehicle-documents";

type VehicleRow = {
  id: string;
  user_id: string;
  registration_number: string;
  normalized_registration_number: string;
  rc_front_path: string | null;
  rc_back_path: string | null;
  insurance_policy_path: string | null;
  verification_status: string;
  rejection_reason: string | null;
  created_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

type HistoryRow = {
  id: string;
  status: string;
  rejection_reason: string | null;
  reviewed_by: string | null;
  note: string | null;
  created_at: string | null;
};

type UserRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
};

async function signedUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(VEHICLE_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export default async function CarVerificationDetailPage({
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
            href="/dashboard?tab=car-verification"
            className="mb-6 inline-block text-sm font-semibold text-indigo-600 hover:underline"
          >
            ← Back to Car Verification
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

  const { data: vehicle, error } = await supabaseAdmin
    .from("user_vehicles")
    .select(
      `
      id,
      user_id,
      registration_number,
      normalized_registration_number,
      rc_front_path,
      rc_back_path,
      insurance_policy_path,
      verification_status,
      rejection_reason,
      created_at,
      reviewed_at,
      reviewed_by
    `,
    )
    .eq("id", id)
    .maybeSingle<VehicleRow>();

  if (error) {
    return (
      <div className="min-h-screen bg-slate-100">
        <main className="mx-auto w-full max-w-3xl px-6 py-10">
          <Link
            href="/dashboard?tab=car-verification"
            className="mb-6 inline-block text-sm font-semibold text-indigo-600 hover:underline"
          >
            ← Back to Car Verification
          </Link>
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
            Could not load vehicle: {error.message}
          </div>
        </main>
      </div>
    );
  }

  if (!vehicle) {
    notFound();
  }

  const [{ data: owner }, { data: history }, rcFrontUrl, rcBackUrl, insuranceUrl] =
    await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id, first_name, last_name, phone, email")
        .eq("id", vehicle.user_id)
        .maybeSingle<UserRow>(),
      supabaseAdmin
        .from("user_vehicle_status_history")
        .select(
          "id, status, rejection_reason, reviewed_by, note, created_at",
        )
        .eq("vehicle_id", vehicle.id)
        .order("created_at", { ascending: false })
        .limit(50),
      signedUrl(vehicle.rc_front_path),
      signedUrl(vehicle.rc_back_path),
      signedUrl(vehicle.insurance_policy_path),
    ]);

  const ownerName =
    `${owner?.first_name ?? ""} ${owner?.last_name ?? ""}`.trim() ||
    owner?.phone ||
    owner?.email ||
    vehicle.user_id;

  const documents = [
    { label: "RC Front", url: rcFrontUrl, path: vehicle.rc_front_path },
    { label: "RC Back", url: rcBackUrl, path: vehicle.rc_back_path },
    {
      label: "Insurance Policy",
      url: insuranceUrl,
      path: vehicle.insurance_policy_path,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <Link
          href="/dashboard?tab=car-verification"
          className="mb-6 inline-block text-sm font-semibold text-indigo-600 hover:underline"
        >
          ← Back to Car Verification
        </Link>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">
            Vehicle Verification
          </h1>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">User</dt>
              <dd className="font-semibold text-slate-900">{ownerName}</dd>
              <dd className="text-slate-600">
                <PhoneNumberAction phone={owner?.phone} emptyLabel="—" />
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Registration Number</dt>
              <dd className="font-semibold tracking-wide text-slate-900">
                {vehicle.registration_number}
              </dd>
              <dd className="text-xs text-slate-500">
                Normalized: {vehicle.normalized_registration_number}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd className="capitalize font-semibold text-slate-900">
                {vehicle.verification_status}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Submitted</dt>
              <dd className="text-slate-800">
                {formatDateTime(vehicle.created_at)}
              </dd>
            </div>
            {vehicle.rejection_reason ? (
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Rejection reason</dt>
                <dd className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800">
                  {vehicle.rejection_reason}
                </dd>
              </div>
            ) : null}
            {vehicle.reviewed_at ? (
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Last review</dt>
                <dd className="text-slate-800">
                  {formatDateTime(vehicle.reviewed_at)}
                  {vehicle.reviewed_by ? ` · ${vehicle.reviewed_by}` : ""}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-6">
            <VehicleVerificationActions
              vehicleId={vehicle.id}
              status={vehicle.verification_status}
            />
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Documents</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {documents.map((doc) => (
              <article
                key={doc.label}
                className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
              >
                <div className="aspect-[4/3] bg-slate-100">
                  {doc.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={doc.url}
                      alt={doc.label}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">
                      No document
                    </div>
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <p className="font-semibold text-slate-900">{doc.label}</p>
                  {doc.url ? (
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-indigo-600 hover:underline"
                    >
                      Open full size
                    </a>
                  ) : (
                    <p className="truncate text-xs text-slate-500">
                      {doc.path || "Missing"}
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            Verification history
          </h2>
          <ul className="mt-4 space-y-3">
            {(history as HistoryRow[] | null)?.length ? (
              (history as HistoryRow[]).map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                >
                  <p className="font-semibold capitalize text-slate-900">
                    {row.status}
                    {row.note ? (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        ({row.note})
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(row.created_at)}
                    {row.reviewed_by ? ` · ${row.reviewed_by}` : ""}
                  </p>
                  {row.rejection_reason ? (
                    <p className="mt-1 text-rose-700">{row.rejection_reason}</p>
                  ) : null}
                </li>
              ))
            ) : (
              <li className="text-sm text-slate-500">No history yet.</li>
            )}
          </ul>
        </section>
      </main>
    </div>
  );
}
