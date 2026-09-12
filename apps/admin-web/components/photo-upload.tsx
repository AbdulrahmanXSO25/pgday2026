"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { apiFetch, ApiClientError } from "@/lib/api";

/**
 * PhotoUpload — reusable portrait/logo uploader for admin forms.
 * Flow: presign (API issues URL) → direct PUT to R2/MinIO → confirm → onUploaded(url, key).
 * Bytes never transit the API. Kind-aware limits enforced by the API.
 */

type PresignResponse = {
  id: string;
  url: string;
  storageKey: string;
  key: string;
  expiresAt: string;
};

type ConfirmResponse = {
  id: string;
  storageKey: string;
  status: string;
  url: string;
  kind: string;
};

export function PhotoUpload({
  kind,
  prefix,
  currentUrl,
  onUploaded,
  label = "Photo",
  hint = "JPG, PNG or WebP, up to 5 MB.",
}: {
  kind: "speaker_photo" | "sponsor_logo";
  prefix: string;
  currentUrl?: string | null;
  onUploaded: (url: string, storageKey: string) => void;
  label?: string;
  hint?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      // 1) Presign
      const presignRes = await apiFetch<{ success: true; data: PresignResponse }>(
        "/media/presign",
        {
          method: "POST",
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.type,
            size: file.size,
            kind,
            prefix,
          }),
        }
      );
      const { url, id, storageKey, key } = presignRes.data;
      const putKey = storageKey ?? key;

      // 2) Direct PUT to storage
      const putRes = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error("Upload failed — please try again.");
      }

      // 3) Confirm
      const confirmRes = await apiFetch<{ success: true; data: ConfirmResponse }>(
        "/media/confirm",
        {
          method: "POST",
          body: JSON.stringify({ id, storageKey: putKey }),
        }
      );
      const mediaUrl = confirmRes.data.url;
      setPreview(mediaUrl);
      onUploaded(mediaUrl, putKey);
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
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <span className="admin-label text-ink-muted text-xs uppercase">{label}</span>
      <div className="mt-2 flex items-center gap-4">
        <div className="border-hairline bg-surface-raised flex h-24 w-24 items-center justify-center overflow-hidden rounded-sm border">
          {preview ? (
            <img src={preview} alt="Preview" className="h-full w-full object-cover" />
          ) : (
            <span className="admin-label text-ink-muted text-xs">No photo</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="border-pg-blue bg-pg-blue hover:bg-pg-blue-dark inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" /> {preview ? "Change photo" : "Upload photo"}
              </>
            )}
          </button>
          {preview && (
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                onUploaded("", "");
              }}
              className="text-ink-muted inline-flex items-center gap-1 text-xs hover:underline"
            >
              <X className="h-3 w-3" /> Remove
            </button>
          )}
          <p className="admin-label text-ink-muted text-[11px]">{hint}</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-pg-amber mt-2 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
