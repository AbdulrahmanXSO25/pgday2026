"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { apiFetch, ApiClientError } from "@/lib/api";
import { humanizeStatus } from "@/lib/format";

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const ASSET_MIMES = [...IMAGE_MIMES, "application/pdf"] as const;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_PDF_SIZE = 10 * 1024 * 1024;

type MediaKind = "speaker_photo" | "sponsor_logo" | "asset" | "other";

function allowedMimesFor(kind: MediaKind): readonly string[] {
  return kind === "asset" ? ASSET_MIMES : IMAGE_MIMES;
}
function maxSizeFor(kind: MediaKind, mime: string): number {
  return kind === "asset" && mime === "application/pdf" ? MAX_PDF_SIZE : MAX_IMAGE_SIZE;
}

type ApiMedia = {
  id: string;
  eventId?: string | null;
  event_id?: string | null;
  filename: string;
  originalName?: string | null;
  original_name?: string | null;
  mimeType?: string;
  mime_type?: string;
  size: number;
  storageKey?: string;
  storage_key?: string;
  bucket?: string;
  status: string;
  url?: string | null;
  createdAt?: number;
  created_at?: number;
};

type PresignResponse = {
  id: string;
  key: string;
  storageKey: string;
  bucket: string;
  url: string;
  expiresAt: string;
  expiresIn: number;
  mimeType: string;
  size: number;
  status: string;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function MediaPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [prefix, setPrefix] = useState<string>("media");
  const [kind, setKind] = useState<MediaKind>("speaker_photo");

  const mediaQ = useQuery({
    queryKey: ["admin", "media"],
    queryFn: async () => {
      const res = await apiFetch<{ success: true; data: ApiMedia[] }>("/media", { method: "GET" });
      return res.data;
    },
    retry: false,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch<{ success: true; data: { id: string } }>(`/media/${id}`, {
        method: "DELETE",
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "media"] });
      setSuccess("Deleted.");
      setTimeout(() => setSuccess(null), 2500);
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : "Delete failed";
      setError(msg);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    setSuccess(null);
    if (!f) {
      setSelectedFile(null);
      return;
    }
    const allowed = allowedMimesFor(kind);
    if (!(allowed as readonly string[]).includes(f.type)) {
      setError(`Unsupported type for ${kind}: ${f.type}. Allowed: ${allowed.join(", ")}`);
      setSelectedFile(null);
      return;
    }
    const maxSize = maxSizeFor(kind, f.type);
    if (f.size > maxSize) {
      setError(`File too large: ${formatBytes(f.size)} > ${formatBytes(maxSize)}`);
      setSelectedFile(null);
      return;
    }
    setSelectedFile(f);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!selectedFile) {
      setError("Choose a file first.");
      return;
    }
    setUploading(true);
    try {
      // 1) Presign — §17.3 (API only issues the URL; bytes never transit the API)
      const presignRes = await apiFetch<{ success: true; data: PresignResponse }>(
        "/media/presign",
        {
          method: "POST",
          body: JSON.stringify({
            filename: selectedFile.name,
            mimeType: selectedFile.type,
            size: selectedFile.size,
            kind,
            prefix,
          }),
        }
      );
      const { url, id, storageKey, key } = presignRes.data;
      const putKey = storageKey ?? key;

      // 2) Direct PUT to storage (MinIO :9000 locally, R2 in prod)
      const putRes = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": selectedFile.type },
        body: selectedFile,
      });
      if (!putRes.ok) {
        throw new Error(
          `The file could not be uploaded. Please try again, and contact support if the problem continues.`
        );
      }

      // 3) Confirm — API verifies the stored object and flips pending → ready
      await apiFetch<{ success: true; data: unknown }>("/media/confirm", {
        method: "POST",
        body: JSON.stringify({ id, storageKey: putKey }),
      });
      setSuccess(`Uploaded ${selectedFile.name} — ready.`);
      qc.invalidateQueries({ queryKey: ["admin", "media"] });
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Upload failed";
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="w-full">
      <p className="admin-label text-pg-blue mb-2">Files</p>
      <h1 className="text-2xl font-bold tracking-tight">Media</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Files go straight to storage and never travel through this panel. Only confirmed uploads are
        used by the website.
      </p>

      <div className="card mt-6 p-5">
        <h2 className="text-sm font-semibold">Upload a file</h2>
        <p className="admin-label text-ink-muted mt-1 text-xs">
          Photos and logos: JPG, PNG or WebP, up to 5 MB. Files: also PDF, up to 10 MB.
        </p>
        <form onSubmit={handleUpload} className="mt-4 grid gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label
                htmlFor="media-file"
                className="admin-label text-ink-muted block text-xs font-medium"
              >
                File
              </label>
              <input
                id="media-file"
                ref={fileRef}
                type="file"
                accept={allowedMimesFor(kind).join(",")}
                onChange={handleFileChange}
                className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
              />
              {selectedFile ? (
                <p className="admin-label text-ink-muted mt-1 text-xs">
                  {selectedFile.name} · {selectedFile.type} · {formatBytes(selectedFile.size)}
                </p>
              ) : null}
            </div>
            <div className="w-full sm:w-44">
              <label
                htmlFor="media-kind"
                className="admin-label text-ink-muted block text-xs font-medium"
              >
                Kind
              </label>
              <select
                id="media-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as MediaKind)}
                className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
              >
                <option value="speaker_photo">speaker_photo</option>
                <option value="sponsor_logo">sponsor_logo</option>
                <option value="asset">asset (pdf)</option>
                <option value="other">other</option>
              </select>
            </div>
            <div className="w-full sm:w-40">
              <label
                htmlFor="media-prefix"
                className="admin-label text-ink-muted block text-xs font-medium"
              >
                Prefix
              </label>
              <select
                id="media-prefix"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                className="border-hairline bg-surface mt-1 w-full rounded-sm border px-3 py-2 text-sm"
              >
                <option value="media">media</option>
                <option value="speakers">speakers</option>
                <option value="sponsors">sponsors</option>
                <option value="avatars">avatars</option>
                <option value="general">general</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={uploading || !selectedFile}
              className="bg-pg-blue hover:bg-pg-blue-dark inline-flex rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
            {error ? (
              <span role="alert" className="max-w-prose text-xs text-red-600">
                {error}
              </span>
            ) : success ? (
              <span role="status" className="text-xs font-medium text-green-700">
                {success}
              </span>
            ) : null}
          </div>
        </form>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold">Library</h2>
        {mediaQ.isLoading ? (
          <p className="admin-label text-ink-muted mt-3 text-sm">Loading…</p>
        ) : mediaQ.isError ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {(mediaQ.error as Error).message}
          </p>
        ) : (mediaQ.data?.length ?? 0) === 0 ? (
          <p className="admin-label text-ink-muted mt-3 text-sm">
            No media yet. Upload a speaker photo or sponsor logo.
          </p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(mediaQ.data ?? []).map((row) => {
              const mime = (row.mimeType ?? row.mime_type ?? "") as string;
              const key = (row.storageKey ?? row.storage_key ?? "") as string;
              const orig = (row.originalName ?? row.original_name ?? row.filename) as string;
              return (
                <li key={row.id} className="card overflow-hidden p-0">
                  <div className="bg-page flex h-36 items-center justify-center overflow-hidden">
                    {row.url && row.status === "ready" && mime.startsWith("image/") ? (
                      <img src={row.url} alt={orig} className="h-full w-full object-cover" />
                    ) : (
                      <span className="admin-label text-ink-muted px-3 text-center text-xs">
                        {row.status === "pending" ? "Finishing upload…" : mime || "No preview"}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="truncate text-sm font-semibold">{orig}</p>
                    <p className="admin-label text-ink-muted mt-1 text-xs">
                      {humanizeStatus(row.status)}
                    </p>
                    <p className="admin-label text-ink-muted mt-1 text-xs">
                      {mime} · {formatBytes(row.size)} ·{" "}
                      <span
                        className={
                          row.status === "ready"
                            ? "text-green-700"
                            : row.status === "pending"
                              ? "text-amber-600"
                              : "text-red-600"
                        }
                      >
                        {row.status}
                      </span>
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => {
                          if (confirm(`Delete “${orig}”? This removes the file.`))
                            deleteMut.mutate(row.id);
                        }}
                        disabled={deleteMut.isPending}
                        className="border-hairline hover:bg-page inline-flex rounded-sm border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                      >
                        Delete
                      </button>
                      {row.url ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-pg-blue inline-flex items-center px-2 py-1.5 text-xs hover:underline"
                        >
                          Open
                        </a>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
