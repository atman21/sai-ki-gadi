import Link from "next/link";
import { notFound } from "next/navigation";

import {
    ADMIN_USER_DETAIL_SELECT,
    AdminUserProfileSections,
    adminUserFullName,
    normalizeAdminUserDetail,
} from "@/app/dashboard/components/admin-user-profile-sections";
import { supabaseAdmin } from "@/lib/supabase-admin";

import { DocumentManager } from "./document-manager";
import { VerificationActions } from "./verification-actions";

const IDENTITY_BUCKET = "identity-documents";

type IdentityDocRow = {
  user_id: string;
  aadhaar_number?: string | null;
  aadhaar_file_path?: string | null;
  pan_file_path?: string | null;
  gst_file_path?: string | null;
  driving_license_front_path?: string | null;
  driving_license_back_path?: string | null;
  aadhaar_front_path?: string | null;
  aadhaar_back_path?: string | null;
};

type DocumentItem = {
  label: string;
  pathField: string;
  path: string | null;
  signedUrl: string | null;
};

async function createSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(IDENTITY_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function fetchAdminUser(userId: string) {
  const primary = await supabaseAdmin
    .from("users")
    .select(ADMIN_USER_DETAIL_SELECT)
    .eq("id", userId)
    .maybeSingle();

  if (!primary.error && primary.data) {
    return normalizeAdminUserDetail(
      primary.data as unknown as Record<string, unknown>,
    );
  }

  const fallback = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (fallback.error) {
    throw new Error(
      `Unable to load user details: ${primary.error?.message ?? fallback.error.message}`,
    );
  }
  if (!fallback.data) return null;

  return normalizeAdminUserDetail(
    fallback.data as unknown as Record<string, unknown>,
  );
}

export default async function VerificationUserPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;

  const [user, docsResult] = await Promise.all([
    fetchAdminUser(userId),
    (async () => {
      const modern = await supabaseAdmin
        .from("user_identity_documents")
        .select(
          "user_id, aadhaar_number, driving_license_front_path, driving_license_back_path, aadhaar_front_path, aadhaar_back_path",
        )
        .eq("user_id", userId)
        .maybeSingle<IdentityDocRow>();
      if (!modern.error) return modern;
      return supabaseAdmin
        .from("user_identity_documents")
        .select(
          "user_id, aadhaar_number, aadhaar_file_path, pan_file_path, gst_file_path",
        )
        .eq("user_id", userId)
        .maybeSingle<IdentityDocRow>();
    })(),
  ]);

  if (!user) {
    notFound();
  }

  const { data: docs, error: docsError } = docsResult;
  if (docsError) {
    throw new Error(`Unable to load user documents: ${docsError.message}`);
  }

  const baseDocs: Omit<DocumentItem, "signedUrl">[] =
    docs?.driving_license_front_path !== undefined
      ? [
          {
            label: "Driving License Front",
            pathField: "driving_license_front_path",
            path: docs?.driving_license_front_path ?? null,
          },
          {
            label: "Driving License Back",
            pathField: "driving_license_back_path",
            path: docs?.driving_license_back_path ?? null,
          },
          {
            label: "Aadhaar Front",
            pathField: "aadhaar_front_path",
            path: docs?.aadhaar_front_path ?? null,
          },
          {
            label: "Aadhaar Back",
            pathField: "aadhaar_back_path",
            path: docs?.aadhaar_back_path ?? null,
          },
        ]
      : [
          {
            label: "Aadhaar Document",
            pathField: "aadhaar_file_path",
            path: docs?.aadhaar_file_path ?? null,
          },
          {
            label: "PAN Document",
            pathField: "pan_file_path",
            path: docs?.pan_file_path ?? null,
          },
          {
            label: "GST Document",
            pathField: "gst_file_path",
            path: docs?.gst_file_path ?? null,
          },
        ];

  const documents: DocumentItem[] = await Promise.all(
    baseDocs.map(async (doc) => ({
      ...doc,
      signedUrl: doc.path ? await createSignedUrl(doc.path) : null,
    })),
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-6">
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-indigo-600 hover:underline"
          >
            ← Back to dashboard
          </Link>
        </div>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {adminUserFullName(user)}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Review user details and uploaded verification documents. Empty
            values show as -.
          </p>

          <div className="mt-5">
            <VerificationActions
              userId={userId}
              isVerified={Boolean(user.verified)}
              verificationStatus={user.verification_status}
              rejectionReason={user.verification_rejection_reason}
            />
          </div>
        </section>

        <AdminUserProfileSections
          user={user}
          aadhaarNumber={docs?.aadhaar_number ?? null}
        />

        <DocumentManager userId={userId} documents={documents} />
      </main>
    </div>
  );
}
