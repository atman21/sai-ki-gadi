"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type VerificationActionsProps = {
  userId: string;
  isVerified: boolean;
  verificationStatus?: string | null;
  rejectionReason?: string | null;
};

export function VerificationActions({
  userId,
  isVerified,
  verificationStatus,
  rejectionReason,
}: VerificationActionsProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  const acceptVerification = async () => {
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/verify-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Could not mark user as verified.");
        return;
      }
      router.push("/dashboard?tab=pending");
      router.refresh();
    } catch {
      setError("Could not mark user as verified.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const rejectVerification = async () => {
    setError("");
    const reason = rejectReason.trim();
    if (!reason) {
      setError("Please enter a rejection reason for the user.");
      setShowRejectForm(true);
      return;
    }
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/admin/reject-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId, rejectionReason: reason }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Could not reject user.");

        return;
      }

      router.push("/dashboard?tab=rejected-partial");
      router.refresh();
    } catch {
      setError("Could not reject user.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mt-4 space-y-3">
      {verificationStatus === "rejected" && rejectionReason ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          Current rejection reason: {rejectionReason}
        </p>
      ) : null}

      {showRejectForm ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
          <label
            htmlFor="reject-reason"
            className="mb-1 block text-sm font-semibold text-rose-900"
          >
            Rejection reason (shown to the user)
          </label>
          <textarea
            id="reject-reason"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            rows={3}
            className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-rose-300 focus:ring-2"
            placeholder="Explain what the user must correct…"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            void acceptVerification();
          }}
          disabled={isVerified || isSubmitting}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isVerified
            ? "Already Verified"
            : isSubmitting
              ? "Accepting..."
              : "Accept Verification"}
        </button>
        <button
          onClick={() => {
            if (!showRejectForm) {
              setShowRejectForm(true);
              return;
            }
            void rejectVerification();
          }}
          disabled={isVerified || isSubmitting}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting
            ? "Rejecting..."
            : showRejectForm
              ? "Confirm Reject"
              : "Reject"}
        </button>
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </div>
    </div>
  );
}
