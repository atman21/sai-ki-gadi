"use client";

import { useCallback, useEffect, useState } from "react";

type DisputedRow = {
  id: string;
  mobile_number: string;
  remarks: string;
  evidence_path: string | null;
  created_at: string;
  updated_at: string;
};

type Mode = "list" | "add" | "edit" | "view";

function formatDt(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN");
  } catch {
    return iso;
  }
}

export function DisputedNumbersPanel() {
  const [rows, setRows] = useState<DisputedRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("list");
  const [active, setActive] = useState<DisputedRow | null>(null);
  const [mobile, setMobile] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (q) params.set("q", q);
      const res = await fetch(`/api/admin/disputed-numbers?${params}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Failed to load disputed numbers");
      }
      setRows(json.rows ?? []);
      setTotal(json.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [page, q]);

  useEffect(() => {
    void load();
  }, [load]);

  function openAdd() {
    setMode("add");
    setActive(null);
    setMobile("");
    setRemarks("");
    setFile(null);
    setEvidenceUrl(null);
    setError(null);
  }

  function openEdit(row: DisputedRow) {
    setMode("edit");
    setActive(row);
    setMobile(row.mobile_number);
    setRemarks(row.remarks);
    setFile(null);
    setEvidenceUrl(null);
    setError(null);
  }

  async function openView(row: DisputedRow) {
    setMode("view");
    setActive(row);
    setEvidenceUrl(null);
    setError(null);
    if (row.evidence_path) {
      try {
        const res = await fetch(
          `/api/admin/disputed-numbers/${row.id}/evidence`,
        );
        const json = await res.json();
        if (res.ok && json.ok) setEvidenceUrl(json.signedUrl);
      } catch {
        // optional preview
      }
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    const previous = { mobile, remarks };
    try {
      const payload = { mobile_number: mobile, remarks };
      const res = await fetch(
        mode === "edit" && active
          ? `/api/admin/disputed-numbers/${active.id}`
          : "/api/admin/disputed-numbers",
        {
          method: mode === "edit" ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setMobile(previous.mobile);
        setRemarks(previous.remarks);
        throw new Error(json.error ?? "Save failed");
      }

      let row: DisputedRow = json.row;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        const up = await fetch(
          `/api/admin/disputed-numbers/${row.id}/evidence`,
          { method: "POST", body: form },
        );
        const upJson = await up.json();
        if (!up.ok || !upJson.ok) {
          throw new Error(
            upJson.error ??
              "Record saved but evidence upload failed. Try uploading again.",
          );
        }
        row = upJson.row;
      }

      setMode("list");
      setActive(null);
      setFile(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: DisputedRow) {
    if (
      !confirm(
        `Delete disputed number ${row.mobile_number}? This only removes the Admin review flag.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/admin/disputed-numbers/${row.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Delete failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (mode === "add" || mode === "edit" || mode === "view") {
    return (
      <div className="admin-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">
            {mode === "add"
              ? "Add Disputed Number"
              : mode === "edit"
                ? "Edit Disputed Number"
                : "View Disputed Number"}
          </h2>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => setMode("list")}
          >
            Back
          </button>
        </div>
        {error ? (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="grid gap-4 max-w-xl">
          <label className="block">
            <span className="admin-label">Mobile Number</span>
            <input
              className="admin-input mt-1 w-full"
              value={mobile}
              disabled={mode === "view" || saving}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="10-digit Indian mobile"
            />
          </label>
          <label className="block">
            <span className="admin-label">Remarks</span>
            <textarea
              className="admin-input mt-1 w-full min-h-[120px]"
              value={remarks}
              disabled={mode === "view" || saving}
              maxLength={2000}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Required review notes"
            />
          </label>
          {mode !== "view" ? (
            <label className="block">
              <span className="admin-label">
                Private Image Evidence (optional, JPEG/PNG/WebP, max 5 MB)
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="mt-1 block w-full text-sm"
                disabled={saving}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          ) : null}
          {mode === "view" && active?.evidence_path ? (
            <div>
              <p className="admin-label mb-2">Evidence</p>
              {evidenceUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={evidenceUrl}
                  alt="Dispute evidence"
                  className="max-h-80 rounded-lg border border-slate-200"
                />
              ) : (
                <p className="text-sm text-slate-500">Loading signed preview…</p>
              )}
            </div>
          ) : null}
          {mode !== "view" ? (
            <button
              type="button"
              className="admin-btn admin-btn-primary w-fit"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQ(searchInput.trim());
          }}
        >
          <input
            className="admin-input min-w-[220px]"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search mobile or remarks"
          />
          <button type="submit" className="admin-btn admin-btn-secondary">
            Search
          </button>
        </form>
        <button
          type="button"
          className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
          onClick={openAdd}
        >
          Add Disputed Number
        </button>
      </div>

      {error ? (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="admin-table-wrap">
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                  Mobile Number
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                  Remarks
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                  Evidence
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                  Created
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                  Updated
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No disputed numbers found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {row.mobile_number}
                    </td>
                    <td className="px-4 py-3 text-slate-700 max-w-xs truncate">
                      {row.remarks}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.evidence_path ? "Yes" : "No"}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-sm">
                      {formatDt(row.created_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-sm">
                      {formatDt(row.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded bg-slate-100 px-3 py-1 text-slate-700"
                          onClick={() => void openView(row)}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          className="rounded bg-amber-100 px-3 py-1 text-amber-800"
                          onClick={() => openEdit(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="rounded bg-red-100 px-3 py-1 text-red-700"
                          onClick={() => void remove(row)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <span>
          Page {page} of {totalPages} ({total} total)
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}
