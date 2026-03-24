'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { updateProfile } from '@/server/actions/account';

const NZ_REGIONS = [
  'Auckland', 'Wellington', 'Canterbury', 'Waikato', 'Bay of Plenty',
  'Otago', "Hawke's Bay", 'Manawatū-Whanganui', 'Northland', 'Tasman',
  'Nelson', 'Marlborough', 'Southland', 'Taranaki', 'Gisborne', 'West Coast',
];

interface UserProfile {
  displayName: string;
  username: string;
  email: string;
  emailVerified: Date | null;
  region: string | null;
  bio: string | null;
  agreeMarketing: boolean;
}

export default function SettingsForm({ user }: { user: UserProfile }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [region, setRegion] = useState(user.region ?? '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [marketingEmails, setMarketingEmails] = useState(user.agreeMarketing);
  const [orderEmails, setOrderEmails] = useState(true);
  const [offerEmails, setOfferEmails] = useState(true);
  const [watchlistEmails, setWatchlistEmails] = useState(true);

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isPending, startTransition] = useTransition();

  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const inputClass =
    'w-full h-11 px-4 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8] text-[14px] ' +
    'text-[#141414] placeholder:text-[#C9C5BC] focus:outline-none ' +
    'focus:ring-2 focus:ring-[#D4A843]/30 focus:border-[#D4A843] transition';

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError('');
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

  return (
    <div className="space-y-6">
      {/* ── Section 1: Profile ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
        <h2 className="font-semibold text-[#141414] text-[16px] mb-5">
          Profile settings
        </h2>

        {saveError && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200
            text-[13px] text-red-700">
            {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200
            text-[13px] text-emerald-700">
            Profile updated successfully.
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          {/* Display name */}
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

          {/* Username (read-only) */}
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

          {/* Email (read-only + verified badge) */}
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
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5
                    rounded-full bg-emerald-50 border border-emerald-200
                    text-[11px] font-semibold text-emerald-700"
                >
                  ✓ Verified
                </span>
              )}
            </div>
          </div>

          {/* Region */}
          <div>
            <label className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
              Region
            </label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8]
                text-[14px] text-[#141414] focus:outline-none
                focus:ring-2 focus:ring-[#D4A843]/30 focus:border-[#D4A843] transition"
            >
              <option value="">Select your region</option>
              {NZ_REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Bio */}
          <div>
            <label className="block text-[12.5px] font-semibold text-[#141414] mb-1.5">
              Bio{' '}
              <span className="text-[#9E9A91] font-normal">(optional)</span>
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell buyers a little about yourself..."
              rows={3}
              maxLength={500}
              className="w-full px-4 py-3 rounded-xl border border-[#E3E0D9] bg-[#FAFAF8]
                text-[14px] text-[#141414] placeholder:text-[#C9C5BC]
                focus:outline-none focus:ring-2 focus:ring-[#D4A843]/30
                focus:border-[#D4A843] resize-none transition"
            />
            <p className="text-[11.5px] text-[#9E9A91] mt-1 text-right">
              {bio.length}/500
            </p>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="h-11 px-8 rounded-xl bg-[#D4A843] text-[#141414]
              font-semibold text-[14px] hover:bg-[#B8912E] hover:text-white
              transition-colors disabled:opacity-60"
          >
            {isPending ? 'Saving...' : 'Save changes'}
          </button>
        </form>
      </div>

      {/* ── Section 2: Notification preferences ───────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
        <h2 className="font-semibold text-[#141414] text-[16px] mb-5">
          Notification preferences
        </h2>
        <div className="space-y-4">
          {[
            {
              id: 'order-emails',
              label: 'Email me when someone messages me',
              value: orderEmails,
              set: setOrderEmails,
            },
            {
              id: 'offer-emails',
              label: 'Email me about offers on my listings',
              value: offerEmails,
              set: setOfferEmails,
            },
            {
              id: 'watchlist-emails',
              label: 'Email me when items I watch go on sale',
              value: watchlistEmails,
              set: setWatchlistEmails,
            },
            {
              id: 'marketing-emails',
              label: 'Marketing emails',
              value: marketingEmails,
              set: setMarketingEmails,
              optional: true,
            },
          ].map(({ id, label, value, set, optional }) => (
            <div key={id} className="flex items-center justify-between gap-4">
              <label htmlFor={id} className="text-[13.5px] text-[#141414] cursor-pointer">
                {label}{' '}
                {optional && (
                  <span className="text-[#9E9A91] text-[12px]">(optional)</span>
                )}
              </label>
              <button
                id={id}
                role="switch"
                aria-checked={value}
                onClick={() => set((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full
                  transition-colors shrink-0
                  ${value ? 'bg-[#D4A843]' : 'bg-[#E3E0D9]'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow
                    transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 3: Account actions ────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
        <h2 className="font-semibold text-[#141414] text-[16px] mb-5">
          Account actions
        </h2>
        <div className="space-y-3">
          <Link
            href="/account/security"
            className="flex items-center justify-between px-4 py-3.5
              rounded-xl border border-[#E3E0D9] hover:border-[#D4A843]
              hover:bg-[#F5ECD4]/20 transition-colors group"
          >
            <span className="text-[13.5px] font-medium text-[#141414]">
              Change password
            </span>
            <svg
              className="text-[#9E9A91] group-hover:text-[#D4A843] transition-colors"
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5"
            >
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </Link>

          <Link
            href="/account/verify"
            className="flex items-center justify-between px-4 py-3.5
              rounded-xl border border-[#E3E0D9] hover:border-[#D4A843]
              hover:bg-[#F5ECD4]/20 transition-colors group"
          >
            <span className="text-[13.5px] font-medium text-[#141414]">
              Verify your identity
            </span>
            <svg
              className="text-[#9E9A91] group-hover:text-[#D4A843] transition-colors"
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5"
            >
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </Link>

          <button
            onClick={() => setShowDeleteModal(true)}
            className="w-full flex items-center justify-between px-4 py-3.5
              rounded-xl border border-red-200 text-red-500
              hover:border-red-400 hover:bg-red-50 transition-colors"
          >
            <span className="text-[13.5px] font-medium">Delete my account</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Delete account warning modal ──────────────────────────────── */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm
            flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDeleteModal(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
            <div
              className="w-12 h-12 rounded-full bg-red-50 flex items-center
                justify-center mb-4"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <h2 className="font-[family-name:var(--font-playfair)] text-[1.25rem]
              font-semibold text-[#141414] mb-2">
              Delete your account?
            </h2>
            <p className="text-[13.5px] text-[#73706A] leading-relaxed mb-6">
              This action cannot be undone. All your listings, orders, and data will be
              permanently removed. Please contact{' '}
              <a href="mailto:support@kiwimart.co.nz" className="text-[#D4A843] font-semibold">
                support@kiwimart.co.nz
              </a>{' '}
              to request account deletion.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 h-11 rounded-xl border border-[#E3E0D9]
                  text-[13.5px] font-semibold text-[#141414]
                  hover:bg-[#F8F7F4] transition-colors"
              >
                Cancel
              </button>
              <a
                href="mailto:support@kiwimart.co.nz?subject=Account deletion request"
                className="flex-1 h-11 rounded-xl bg-red-500 text-white
                  text-[13.5px] font-semibold flex items-center justify-center
                  hover:bg-red-600 transition-colors"
              >
                Contact support
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
