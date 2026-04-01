// src/app/(protected)/admin/sellers/[userId]/verify/page.tsx
// ─── Admin ID Verification Review Page ──────────────────────────────────────

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/shared/auth/requirePermission";
import db from "@/lib/db";
import {
  approveIdVerification,
  rejectIdVerification,
} from "@/server/actions/seller";
import { getVerificationDocumentUrl } from "@/server/actions/verification.documents";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Review ID Verification" };
export const dynamic = "force-dynamic";

// ── Document Image (server component with signed URL) ────────────────────────

async function DocumentImage({
  r2Key,
  label,
}: {
  r2Key: string | null;
  label: string;
}) {
  if (!r2Key) return null;

  const result = await getVerificationDocumentUrl(r2Key);
  if (!result.success) {
    return (
      <div className="border border-red-200 bg-red-50 rounded-xl p-4 text-[13px] text-red-700">
        Could not load {label}
      </div>
    );
  }

  return (
    <div>
      <p className="text-[11px] font-medium text-[#73706A] mb-2">{label}</p>
      <img
        src={result.data.url}
        alt={label}
        className="rounded-xl border border-[#E3E0D9] max-h-[400px] w-auto object-contain bg-[#FAFAF8]"
      />
    </div>
  );
}

// ── Client action buttons ────────────────────────────────────────────────────

function ApproveButton({ userId }: { userId: string }) {
  async function handleApprove() {
    "use server";
    await approveIdVerification(userId);
    redirect("/admin/sellers");
  }

  return (
    <form action={handleApprove}>
      <button
        type="submit"
        className="h-10 px-6 rounded-xl bg-green-600 text-white font-semibold text-[13px]
          hover:bg-green-700 transition-colors"
      >
        Approve verification
      </button>
    </form>
  );
}

function RejectForm({ userId }: { userId: string }) {
  async function handleReject(formData: FormData) {
    "use server";
    const reason = formData.get("reason") as string;
    const notes = formData.get("notes") as string;
    await rejectIdVerification({ userId, reason, notes });
    redirect("/admin/sellers");
  }

  return (
    <form action={handleReject} className="space-y-3">
      <select
        name="reason"
        required
        className="w-full h-9 px-3 rounded-lg border border-[#E3E0D9] bg-[#FAFAF8]
          text-[13px] text-[#141414] focus:outline-none focus:ring-2
          focus:ring-red-300 focus:border-red-400"
      >
        <option value="">Select rejection reason...</option>
        <option value="DOCUMENT_UNREADABLE">Document unreadable</option>
        <option value="NAME_MISMATCH">Name doesn&apos;t match account</option>
        <option value="DOCUMENT_EXPIRED">Document expired</option>
        <option value="SUSPECTED_FRAUD">Suspected fraudulent document</option>
        <option value="OTHER">Other</option>
      </select>
      <input
        name="notes"
        placeholder="Additional notes (optional)"
        maxLength={500}
        className="w-full h-9 px-3 rounded-lg border border-[#E3E0D9] bg-[#FAFAF8]
          text-[13px] text-[#141414] placeholder:text-[#C9C5BC]
          focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
      />
      <button
        type="submit"
        className="h-10 px-6 rounded-xl bg-red-600 text-white font-semibold text-[13px]
          hover:bg-red-700 transition-colors"
      >
        Reject verification
      </button>
    </form>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  await requirePermission("APPROVE_SELLERS");
  const { userId } = await params;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      displayName: true,
      email: true,
      username: true,
      phoneVerified: true,
      idVerified: true,
      idSubmittedAt: true,
      createdAt: true,
      verificationApplication: true,
    },
  });

  if (!user) notFound();

  const app = user.verificationApplication;
  if (!app) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-[#73706A]">No verification application found.</p>
        <Link
          href="/admin/sellers"
          className="text-[#D4A843] hover:underline text-[13px] mt-2 inline-block"
        >
          Back to sellers
        </Link>
      </div>
    );
  }

  const docTypeLabels: Record<string, string> = {
    DRIVERS_LICENSE: "NZ Driver's Licence",
    PASSPORT: "NZ Passport",
    NZ_FIREARMS_LICENCE: "NZ Firearms Licence",
    OTHER_GOV_ID: "Other Government ID",
  };

  const accountAgeDays = Math.floor(
    (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24),
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/admin/sellers"
            className="text-[12px] text-[#73706A] hover:text-[#141414] transition-colors"
          >
            &larr; Back to sellers
          </Link>
          <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414] mt-1">
            ID Verification Review
          </h1>
        </div>
        <span
          className={`text-[11px] font-semibold px-3 py-1 rounded-full ${
            app.status === "PENDING"
              ? "bg-amber-100 text-amber-700"
              : app.status === "APPROVED"
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
          }`}
        >
          {app.status}
        </span>
      </div>

      {/* User details */}
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] text-[#9E9A91] font-medium uppercase">
            Name
          </p>
          <p className="text-[14px] text-[#141414] font-semibold">
            {user.displayName}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#9E9A91] font-medium uppercase">
            Email
          </p>
          <p className="text-[14px] text-[#141414]">{user.email}</p>
        </div>
        <div>
          <p className="text-[11px] text-[#9E9A91] font-medium uppercase">
            Username
          </p>
          <p className="text-[14px] text-[#141414]">@{user.username}</p>
        </div>
        <div>
          <p className="text-[11px] text-[#9E9A91] font-medium uppercase">
            Account age
          </p>
          <p className="text-[14px] text-[#141414]">{accountAgeDays} days</p>
        </div>
        <div>
          <p className="text-[11px] text-[#9E9A91] font-medium uppercase">
            Phone verified
          </p>
          <p
            className={`text-[14px] font-medium ${user.phoneVerified ? "text-green-600" : "text-[#9E9A91]"}`}
          >
            {user.phoneVerified ? "Yes" : "No"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#9E9A91] font-medium uppercase">
            Document type
          </p>
          <p className="text-[14px] text-[#141414]">
            {app.documentType
              ? (docTypeLabels[app.documentType] ?? app.documentType)
              : "Not specified"}
          </p>
        </div>
      </div>

      {/* Documents */}
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 space-y-6">
        <h2 className="font-semibold text-[15px] text-[#141414]">
          Submitted Documents
        </h2>

        {!app.documentFrontKey && !app.documentBackKey && !app.selfieKey ? (
          <p className="text-[13px] text-[#73706A]">
            No documents uploaded (legacy submission — timestamp only).
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DocumentImage
              r2Key={app.documentFrontKey}
              label="Front of document"
            />
            <DocumentImage
              r2Key={app.documentBackKey}
              label="Back of document"
            />
            <DocumentImage r2Key={app.selfieKey} label="Selfie with ID" />
          </div>
        )}

        {/* Name comparison */}
        {app.documentType && (
          <div className="bg-[#F8F7F4] rounded-xl border border-[#E3E0D9] p-4">
            <p className="text-[11px] text-[#9E9A91] font-medium uppercase mb-2">
              Name comparison
            </p>
            <div className="flex items-center gap-4">
              <div>
                <p className="text-[11px] text-[#73706A]">Account name</p>
                <p className="text-[14px] font-semibold text-[#141414]">
                  {user.displayName}
                </p>
              </div>
              <span className="text-[#9E9A91]">vs</span>
              <div>
                <p className="text-[11px] text-[#73706A]">Document name</p>
                <p className="text-[14px] font-medium text-[#73706A] italic">
                  Check document image
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {app.status === "PENDING" && (
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 space-y-4">
          <h2 className="font-semibold text-[15px] text-[#141414]">Decision</h2>
          <div className="flex items-start gap-8">
            <ApproveButton userId={user.id} />
            <div className="flex-1">
              <p className="text-[12px] font-medium text-red-600 mb-2">
                Reject with reason:
              </p>
              <RejectForm userId={user.id} />
            </div>
          </div>
        </div>
      )}

      {/* Previous decision */}
      {app.status !== "PENDING" && app.adminNotes && (
        <div className="bg-[#F8F7F4] rounded-2xl border border-[#E3E0D9] p-6">
          <p className="text-[11px] text-[#9E9A91] font-medium uppercase mb-1">
            Admin notes
          </p>
          <p className="text-[13px] text-[#141414]">{app.adminNotes}</p>
          {app.reviewedAt && (
            <p className="text-[11px] text-[#9E9A91] mt-2">
              Reviewed{" "}
              {new Date(app.reviewedAt).toLocaleDateString("en-NZ", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
