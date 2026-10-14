import { BackButton } from "@/app/components/back-button";
import { notFound } from "next/navigation";

import { AdminWalletPanel } from "@/app/dashboard/components/admin-wallet-panel";
import {
  ADMIN_USER_DETAIL_SELECT,
  AdminUserProfileSections,
  adminUserFullName,
  normalizeAdminUserDetail,
} from "@/app/dashboard/components/admin-user-profile-sections";
import { supabaseAdmin } from "@/lib/supabase-admin";

import { DocumentManager } from "../../../dashboard/verification/[userId]/document-manager";

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

const IDENTITY_BUCKET = "identity-documents";

async function createSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(IDENTITY_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function fetchAdminUser(id: string) {
  const primary = await supabaseAdmin
    .from("users")
    .select(ADMIN_USER_DETAIL_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (!primary.error && primary.data) {
    return normalizeAdminUserDetail(
      primary.data as unknown as Record<string, unknown>,
    );
  }

  // Fallback: if an explicit column is missing from schema cache, still load the row.
  const fallback = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (fallback.error) {
    throw new Error(
      `Unable to load user: ${primary.error?.message ?? fallback.error.message}`,
    );
  }
  if (!fallback.data) return null;

  return normalizeAdminUserDetail(
    fallback.data as unknown as Record<string, unknown>,
  );
}

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [user, docsResult] = await Promise.all([
    fetchAdminUser(id),
    (async () => {
      const modern = await supabaseAdmin
        .from("user_identity_documents")
        .select(
          "user_id, aadhaar_number, driving_license_front_path, driving_license_back_path, aadhaar_front_path, aadhaar_back_path",
        )
        .eq("user_id", id)
        .maybeSingle<IdentityDocRow>();
      if (!modern.error) return modern;
      return supabaseAdmin
        .from("user_identity_documents")
        .select(
          "user_id, aadhaar_number, aadhaar_file_path, pan_file_path, gst_file_path",
        )
        .eq("user_id", id)
        .maybeSingle<IdentityDocRow>();
    })(),
  ]);

  if (!user) notFound();

  const { data: docs } = docsResult;

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

  const name = adminUserFullName(user);

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-6">
          <BackButton />
        </div>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-5">
            {user.profile_image ? (
              <img
                src={user.profile_image}
                alt={name}
                className="h-20 w-20 flex-shrink-0 rounded-full border border-slate-200 object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xl font-bold text-slate-400">
                {name.charAt(0).toUpperCase()}
              </div>
            )}

            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {name}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Complete profile, membership, roles, and verification details.
                Empty values show as -.
              </p>
            </div>
          </div>
        </section>

        <AdminUserProfileSections
          user={user}
          aadhaarNumber={docs?.aadhaar_number ?? null}
        />

        <AdminWalletPanel userId={id} />

        <DocumentManager
          userId={id}
          documents={documents}
          profileImage={user.profile_image}
        />
      </main>
    </div>
  );
}
