"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  updateProfile,
  deleteAccount,
  changePassword,
} from "@/server/actions/account";

const NZ_REGIONS_DEFAULT = [
  "Auckland",
  "Wellington",
  "Canterbury",
  "Waikato",
  "Bay of Plenty",
  "Otago",
  "Hawke's Bay",
  "Manawatū-Whanganui",
  "Northland",
  "Tasman",
  "Nelson",
  "Marlborough",
  "Southland",
  "Taranaki",
  "Gisborne",
  "West Coast",
];

interface UserProfile {
  displayName: string;
  username: string;
  email: string;
  emailVerified: Date | null;
  region: string | null;
  bio: string | null;
  hasMarketingConsent: boolean;
}

type Visibility = "public" | "buyers" | "private";

const sectionHeadingClass = "font-semibold text-[#141414] text-[16px] mb-5";
const sectionCardClass =
  "bg-white rounded-2xl border border-[#E3E0D9] p-6 scroll-mt-24";
const inputClass =
  "w-full h-11 px-4 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8] text-[14px] " +
  "text-[#141414] placeholder:text-[#C9C5BC] focus:outline-none " +
  "focus:ring-2 focus:ring-[#D4A843]/30 focus:border-[#D4A843] transition";

export default function SettingsForm({
  user,
  regions,
}: {
  user: UserProfile;
  regions?: string[];
}) {
  const NZ_REGIONS = regions ?? NZ_REGIONS_DEFAULT;
  const [displayName, setDisplayName] = useState(user.displayName);
  const [region, setRegion] = useState(user.region ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [marketingEmails, setMarketingEmails] = useState(
    user.hasMarketingConsent,
  );
  const [orderEmails, setOrderEmails] = useState(true);
  const [offerEmails, setOfferEmails] = useState(true);
  const [watchlistEmails, setWatchlistEmails] = useState(true);

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [isPending, startTransition] = useTransition();

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);
  const [isPwPending, startPwTransition] = useTransition();

  // Privacy state
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [privacyToast, setPrivacyToast] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const router = useRouter();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError("");
    setSaveSuccess(false);
    startTransition(async () => {
      const result = await updateProfile({ displayName, region, bio });
      if (result.success) {
        setSaveSuccess(true);
      } else {
        setSaveError(result.error);
      }
    });
  }

  function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    setPwSuccess(false);
    startPwTransition(async () => {
      const result = await changePassword({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      if (result.success) {
        setPwSuccess(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPwError(result.error);
      }
    });
  }

  function showPrivacyToast(msg: string) {
    setPrivacyToast(msg);
    setTimeout(() => setPrivacyToast(""), 2500);
  }

  // Calculate profile completeness
  const fields = [
    !!user.displayName,
    !!user.email,
    !!user.emailVerified,
    !!region,
    !!bio,
  ];
  const completePct = Math.round(
    (fields.filter(Boolean).length / fields.length) * 100,
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
      {/* ── Left column: Main forms (3/5) ────────────────────────────── */}
      <div className="lg:col-span-3 space-y-6 max-w-2xl">
        {/* ── Profile section ───────────────────────────────────────── */}
        <div id="profile" className={sectionCardClass}>
          <h2 className={sectionHeadingClass}>Profile settings</h2>

          {saveError && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
              {saveError}
            </div>
          )}
          {saveSuccess && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[13px] text-emerald-700">
              Profile updated successfully.
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                Display name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass}
                required
                minLength={2}
                maxLength={60}
              />
            </div>

            <div>
              <label className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={user.username}
                className={`${inputClass} opacity-60 cursor-not-allowed`}
                readOnly
                disabled
              />
              <p className="text-[11.5px] text-[#9E9A91] mt-1">
                Your username cannot be changed.
              </p>
            </div>

            <div>
              <label className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                Email address
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={user.email}
                  className={`${inputClass} pr-24 opacity-60 cursor-not-allowed`}
                  readOnly
                  disabled
                />
                {user.emailVerified && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-700">
                    Verified
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                Region
              </label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full h-11 px-4 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8] text-[14px] text-[#141414] focus:outline-none focus:ring-2 focus:ring-[#D4A843]/30 focus:border-[#D4A843] transition"
              >
                <option value="">Select your region</option>
                {NZ_REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
                Bio{" "}
                <span className="text-[#9E9A91] font-normal">(optional)</span>
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell buyers a little about yourself..."
                rows={3}
                maxLength={500}
                className="w-full px-4 py-3 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8] text-[14px] text-[#141414] placeholder:text-[#C9C5BC] focus:outline-none focus:ring-2 focus:ring-[#D4A843]/30 focus:border-[#D4A843] resize-none transition"
              />
              <p className="text-[11.5px] text-[#9E9A91] mt-1 text-right">
                {bio.length}/500
              </p>
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="h-11 px-8 rounded-xl bg-[#D4A843] text-[#141414] font-semibold text-[14px] hover:bg-[#B8912E] hover:text-white transition-colors disabled:opacity-60"
            >
              {isPending ? "Saving..." : "Save changes"}
            </button>
          </form>
        </div>

        {/* ── Security section ──────────────────────────────────────── */}
        <div id="security" className={sectionCardClass}>
          <h2 className={sectionHeadingClass}>Security settings</h2>

          {pwError && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
              {pwError}
            </div>
          )}
          {pwSuccess && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[13px] text-emerald-700">
              Password changed successfully.
            </div>
          )}

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label
                htmlFor="current-password"
                className="block text-[12.5px] font-semibold text-[#141414] mb-1.5"
              >
                Current password
              </label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputClass}
                required
                autoComplete="current-password"
              />
            </div>

            <div>
              <label
                htmlFor="new-password"
                className="block text-[12.5px] font-semibold text-[#141414] mb-1.5"
              >
                New password
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
                required
                minLength={12}
                autoComplete="new-password"
              />
              <p className="text-[11px] text-[#9E9A91] mt-1">
                Min 12 characters, must include uppercase, lowercase, and a
                number.
              </p>
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="block text-[12.5px] font-semibold text-[#141414] mb-1.5"
              >
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
                required
                autoComplete="new-password"
              />
            </div>

            <button
              type="submit"
              disabled={isPwPending}
              className="h-11 px-8 rounded-xl bg-[#141414] text-white font-semibold text-[14px] hover:bg-[#D4A843] hover:text-[#141414] transition-colors disabled:opacity-60"
            >
              {isPwPending ? "Updating..." : "Update password"}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-[#F0EDE8]">
            <p className="text-[13px] text-[#73706A] mb-3">
              Need extra protection? Enable two-factor authentication for
              additional account security.
            </p>
            <Link
              href="/account/security"
              className="inline-flex items-center justify-center h-9 px-5 rounded-full border border-[#E3E0D9] text-[13px] font-semibold text-[#141414] hover:border-[#D4A843] hover:text-[#D4A843] transition-colors"
            >
              Manage 2FA
            </Link>
          </div>
        </div>

        {/* ── Privacy section ───────────────────────────────────────── */}
        <div id="privacy" className={sectionCardClass}>
          <h2 className={sectionHeadingClass}>Privacy &amp; data</h2>

          {privacyToast && (
            <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-200 text-[13px] text-blue-700">
              {privacyToast}
            </div>
          )}

          <div className="space-y-6">
            {/* Download my data */}
            <div>
              <p className="text-[13.5px] font-semibold text-[#141414] mb-1">
                Download my data
              </p>
              <p className="text-[12.5px] text-[#73706A] mb-3 leading-relaxed">
                Export a copy of your account data including profile, orders,
                messages, and listings in a machine-readable format.
              </p>
              <button
                type="button"
                disabled={isExporting}
                onClick={async () => {
                  setIsExporting(true);
                  try {
                    const res = await fetch("/api/v1/account/export-data", {
                      method: "POST",
                    });
                    const data = await res.json();
                    if (res.ok) {
                      showPrivacyToast(
                        data.data?.message ??
                          "Your data export has been emailed to you.",
                      );
                    } else {
                      showPrivacyToast(
                        data.error ?? "Export failed. Please try again.",
                      );
                    }
                  } catch {
                    showPrivacyToast("Export failed. Please try again.");
                  } finally {
                    setIsExporting(false);
                  }
                }}
                className="inline-flex items-center justify-center h-9 px-5 rounded-full border border-[#E3E0D9] text-[13px] font-semibold text-[#141414] hover:border-[#D4A843] hover:text-[#D4A843] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isExporting ? "Exporting..." : "Download my data"}
              </button>
            </div>

            <div className="pt-6 border-t border-[#F0EDE8]">
              <p className="text-[13.5px] font-semibold text-[#141414] mb-1">
                Who can see my profile
              </p>
              <p className="text-[12.5px] text-[#73706A] mb-3 leading-relaxed">
                Control who can view your profile page, listings history, and
                public activity.
              </p>
              <fieldset className="space-y-2.5">
                {[
                  {
                    value: "public" as const,
                    label: "Public",
                    desc: "Anyone on the internet can view your profile.",
                  },
                  {
                    value: "buyers" as const,
                    label: "Buyers only",
                    desc: "Only signed-in KiwiMart members can view your profile.",
                  },
                  {
                    value: "private" as const,
                    label: "Private",
                    desc: "Only you and users you transact with can see your profile.",
                  },
                ].map(({ value, label, desc }) => (
                  <label
                    key={value}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      visibility === value
                        ? "border-[#D4A843] bg-[#F5ECD4]/20"
                        : "border-[#E3E0D9] hover:bg-[#FAFAF8]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value={value}
                      checked={visibility === value}
                      onChange={() => setVisibility(value)}
                      className="mt-0.5 accent-[#D4A843]"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#141414]">
                        {label}
                      </p>
                      <p className="text-[12px] text-[#73706A] leading-snug">
                        {desc}
                      </p>
                    </div>
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                onClick={() =>
                  showPrivacyToast("Privacy preferences saved (coming soon)")
                }
                className="mt-4 h-11 px-8 rounded-xl bg-[#D4A843] text-[#141414] font-semibold text-[14px] hover:bg-[#B8912E] hover:text-white transition-colors"
              >
                Save privacy preferences
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right column: sticky sidebar (2/5) ───────────────────────── */}
      <div className="lg:col-span-2 space-y-6 lg:sticky lg:top-24 lg:self-start">
        {/* Profile completeness */}
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
          <h2 className="font-semibold text-[#141414] text-[16px] mb-4">
            Profile completeness
          </h2>
          <div className="relative h-3 bg-[#F0EDE8] rounded-full overflow-hidden mb-3">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#D4A843] transition-all duration-500"
              style={{ width: `${completePct}%` }}
            />
          </div>
          <p className="text-[13px] text-[#73706A] mb-4">
            <span className="font-semibold text-[#141414]">{completePct}%</span>{" "}
            complete
          </p>
          <ul className="space-y-2">
            {[
              { done: !!user.displayName, label: "Display name" },
              { done: !!user.emailVerified, label: "Email verified" },
              { done: !!region, label: "Region selected" },
              { done: !!bio, label: "Bio written" },
            ].map(({ done, label }) => (
              <li key={label} className="flex items-center gap-2 text-[12.5px]">
                {done ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#16a34a"
                    strokeWidth="2.5"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#C9C5BC"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                )}
                <span className={done ? "text-[#141414]" : "text-[#9E9A91]"}>
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Notification preferences */}
        <div
          id="notifications"
          className="bg-white rounded-2xl border border-[#E3E0D9] p-6 scroll-mt-24"
        >
          <h2 className={sectionHeadingClass}>Notification preferences</h2>
          <div className="space-y-4">
            {[
              {
                id: "order-emails",
                label: "Message notifications",
                value: orderEmails,
                set: setOrderEmails,
              },
              {
                id: "offer-emails",
                label: "Offer notifications",
                value: offerEmails,
                set: setOfferEmails,
              },
              {
                id: "watchlist-emails",
                label: "Watchlist price drops",
                value: watchlistEmails,
                set: setWatchlistEmails,
              },
              {
                id: "marketing-emails",
                label: "Marketing emails",
                value: marketingEmails,
                set: setMarketingEmails,
                optional: true,
              },
            ].map(({ id, label, value, set, optional }) => (
              <div key={id} className="flex items-center justify-between gap-4">
                <label
                  htmlFor={id}
                  className="text-[13px] text-[#141414] cursor-pointer"
                >
                  {label}{" "}
                  {optional && (
                    <span className="text-[#9E9A91] text-[11px]">
                      (optional)
                    </span>
                  )}
                </label>
                <button
                  id={id}
                  role="switch"
                  aria-checked={value}
                  onClick={() => set((v: boolean) => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${value ? "bg-[#D4A843]" : "bg-[#E3E0D9]"}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${value ? "translate-x-6" : "translate-x-1"}`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Account actions */}
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
          <h2 className="font-semibold text-[#141414] text-[16px] mb-5">
            Account actions
          </h2>
          <div className="space-y-3">
            <Link
              href="/account/verify"
              className="flex items-center justify-between px-4 py-3.5 rounded-xl border border-[#E3E0D9] hover:border-[#D4A843] hover:bg-[#F5ECD4]/20 transition-colors group"
            >
              <span className="text-[13.5px] font-medium text-[#141414]">
                Verify your identity
              </span>
              <svg
                className="text-[#9E9A91] group-hover:text-[#D4A843] transition-colors"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>

            <button
              onClick={() => setShowDeleteModal(true)}
              className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl border border-red-200 text-red-500 hover:border-red-400 hover:bg-red-50 transition-colors"
            >
              <span className="text-[13.5px] font-medium">
                Delete my account
              </span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Delete account confirmation modal ───────────────────────── */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDeleteModal(false);
              setDeleteConfirmText("");
              setDeleteError("");
            }
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ef4444"
                strokeWidth="2"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.25rem] font-semibold text-[#141414] mb-2">
              Delete your account?
            </h2>
            <p className="text-[13.5px] text-[#73706A] leading-relaxed mb-4">
              This action <strong>cannot be undone</strong>. Your personal data
              will be anonymised and your listings will be removed. Order
              history is retained for tax compliance.
            </p>
            <p className="text-[13px] text-[#141414] font-medium mb-2">
              Type{" "}
              <span className="font-mono font-bold text-red-600">DELETE</span>{" "}
              to confirm:
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE"
              className={`${inputClass} mb-4`}
              autoComplete="off"
            />
            {deleteError && (
              <p className="text-[13px] text-red-600 mb-4">{deleteError}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmText("");
                  setDeleteError("");
                }}
                className="flex-1 h-11 rounded-xl border border-[#E3E0D9] text-[13.5px] font-semibold text-[#141414] hover:bg-[#F8F7F4] transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={deleteConfirmText !== "DELETE" || isDeleting}
                onClick={() => {
                  setDeleteError("");
                  startDeleteTransition(async () => {
                    const result = await deleteAccount();
                    if (result.success) {
                      router.push("/login?deleted=true");
                    } else {
                      setDeleteError(result.error ?? "Deletion failed.");
                    }
                  });
                }}
                className="flex-1 h-11 rounded-xl bg-red-500 text-white text-[13.5px] font-semibold flex items-center justify-center hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isDeleting ? "Deleting..." : "Delete my account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
