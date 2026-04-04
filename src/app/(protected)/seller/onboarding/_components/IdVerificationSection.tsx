"use client";
// src/app/(protected)/seller/onboarding/_components/IdVerificationSection.tsx

import { useState } from "react";
import {
  requestVerificationUpload,
  submitIdVerification,
} from "@/server/actions/verification.documents";
import type { UserProps, VerificationAppProps } from "./types";

const DOC_TYPES = [
  { value: "DRIVERS_LICENSE", label: "NZ Driver's Licence" },
  { value: "PASSPORT", label: "NZ Passport" },
  { value: "NZ_FIREARMS_LICENCE", label: "NZ Firearms Licence" },
  { value: "OTHER_GOV_ID", label: "Other Government ID" },
] as const;

function DocumentUploadButton({
  label,
  r2Key,
  onUploaded,
  disabled,
}: {
  label: string;
  r2Key: string | null;
  onUploaded: (key: string) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    try {
      // Phase 1: Get presigned URL
      const result = await requestVerificationUpload({
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (!result.success) {
        setError(result.error);
        setUploading(false);
        return;
      }

      // Phase 2: Upload directly to R2
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", result.data.uploadUrl, true);
      xhr.setRequestHeader("Content-Type", file.type);
      await new Promise<void>((resolve, reject) => {
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error("Upload failed"));
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(file);
      });

      onUploaded(result.data.r2Key);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="block text-[11px] font-medium text-[#73706A] mb-1">
        {label}
      </label>
      {r2Key ? (
        <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-green-200 bg-green-50 text-[12px] text-green-700">
          <span>✓</span> Uploaded
        </div>
      ) : (
        <label
          className={`flex items-center justify-center h-9 px-3 rounded-lg border border-dashed
            border-[#E3E0D9] bg-[#FAFAF8] text-[12px] text-[#73706A] cursor-pointer
            hover:border-[#D4A843] hover:text-[#D4A843] transition-colors
            ${disabled || uploading ? "opacity-50 pointer-events-none" : ""}`}
        >
          {uploading ? "Uploading..." : "Choose file"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileChange}
            disabled={disabled || uploading}
          />
        </label>
      )}
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  );
}

export function IdVerificationSection({
  user,
  verificationApp,
  termsAccepted,
  onSubmitted,
}: {
  user: UserProps;
  verificationApp: VerificationAppProps | null;
  termsAccepted: boolean;
  onSubmitted: () => void;
}) {
  const [docType, setDocType] = useState<string>("");
  const [frontKey, setFrontKey] = useState<string | null>(null);
  const [backKey, setBackKey] = useState<string | null>(null);
  const [selfieKey, setSelfieKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // State 3: Approved
  if (user.idVerified) {
    return (
      <p className="text-[12.5px] text-green-700">
        ID verified on{" "}
        {user.idVerifiedAt
          ? new Date(user.idVerifiedAt).toLocaleDateString("en-NZ")
          : "\u2014"}
      </p>
    );
  }

  // State 2: Pending
  if (verificationApp?.status === "PENDING") {
    return (
      <div className="space-y-1">
        <p className="text-[12.5px] text-amber-700">
          Your documents are being reviewed. This usually takes 1-2 business
          days.
        </p>
        <p className="text-[11px] text-[#9E9A91]">
          Submitted{" "}
          {new Date(verificationApp.appliedAt).toLocaleDateString("en-NZ", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>
    );
  }

  // State 4: Rejected
  const isRejected = verificationApp?.status === "REJECTED";

  async function handleSubmit() {
    if (!docType || !frontKey) return;
    setSubmitting(true);
    setError("");
    const result = await submitIdVerification({
      documentType: docType,
      documentFrontKey: frontKey,
      documentBackKey: backKey ?? undefined,
      selfieKey: selfieKey ?? undefined,
    });
    setSubmitting(false);
    if (result.success) {
      onSubmitted();
    } else {
      setError(result.error);
    }
  }

  const needsBack =
    docType === "DRIVERS_LICENSE" || docType === "NZ_FIREARMS_LICENCE";

  return (
    <div className="space-y-3 mt-2">
      {isRejected && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[12px] text-red-700">
          Your previous submission was not approved
          {verificationApp?.adminNotes && (
            <>
              :{" "}
              {verificationApp.adminNotes.split(": ").slice(1).join(": ") ||
                verificationApp.adminNotes}
            </>
          )}
          . You can resubmit below.
        </div>
      )}

      {!termsAccepted && (
        <p className="text-[12.5px] text-[#73706A]">
          Accept the seller terms first, then submit your ID.
        </p>
      )}

      <div>
        <label className="block text-[11px] font-medium text-[#73706A] mb-1">
          Document type
        </label>
        <select
          value={docType}
          onChange={(e) => {
            setDocType(e.target.value);
            setFrontKey(null);
            setBackKey(null);
            setSelfieKey(null);
          }}
          disabled={!termsAccepted}
          className="w-full h-9 px-3 rounded-lg border border-[#E3E0D9] bg-[#FAFAF8]
            text-[13px] text-[#141414] focus:outline-none focus:ring-2
            focus:ring-[#D4A843]/40 focus:border-[#D4A843] disabled:opacity-50"
        >
          <option value="">Select document type...</option>
          {DOC_TYPES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {docType && (
        <>
          <DocumentUploadButton
            label="Front of document (required)"
            r2Key={frontKey}
            onUploaded={setFrontKey}
            disabled={!termsAccepted}
          />
          {needsBack && (
            <DocumentUploadButton
              label="Back of document (required)"
              r2Key={backKey}
              onUploaded={setBackKey}
              disabled={!termsAccepted}
            />
          )}
          <DocumentUploadButton
            label="Selfie holding your ID (optional)"
            r2Key={selfieKey}
            onUploaded={setSelfieKey}
            disabled={!termsAccepted}
          />
          <p className="text-[10.5px] text-[#9E9A91]">
            Your documents are encrypted and stored securely. They are only
            visible to {process.env.NEXT_PUBLIC_APP_NAME ?? "Buyzi"}&apos;s
            verification team.
          </p>
          {error && (
            <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <button
            onClick={handleSubmit}
            disabled={
              !termsAccepted ||
              !frontKey ||
              (needsBack && !backKey) ||
              submitting
            }
            className="inline-flex items-center gap-2 text-[12.5px] font-semibold
              bg-[#141414] text-white px-4 py-2 rounded-lg
              hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors"
          >
            {submitting ? "Submitting\u2026" : "Submit for review"}
          </button>
        </>
      )}
    </div>
  );
}
