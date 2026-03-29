"use client";
// src/app/(protected)/admin/team/TeamActions.tsx

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  inviteAdmin,
  changeAdminRole,
  revokeAdminAccess,
} from "@/server/actions/adminTeam";
import { getRoleDisplayName, getRoleBadgeColor } from "@/lib/permissions";
import type { AdminRole } from "@prisma/client";

const ALL_ROLES: AdminRole[] = [
  "SUPER_ADMIN",
  "FINANCE_ADMIN",
  "DISPUTES_ADMIN",
  "TRUST_SAFETY_ADMIN",
  "SUPPORT_ADMIN",
  "SELLER_MANAGER",
  "READ_ONLY_ADMIN",
];

const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Full access to all admin features",
  FINANCE_ADMIN: "Revenue, payouts, refunds",
  DISPUTES_ADMIN: "Dispute resolution, order details",
  TRUST_SAFETY_ADMIN: "User bans, content moderation",
  SUPPORT_ADMIN: "View user & order details",
  SELLER_MANAGER: "Seller approvals & performance",
  READ_ONLY_ADMIN: "Read-only metrics & reports",
};

interface TeamMember {
  id: string;
  email: string;
  displayName: string;
  adminRole: AdminRole;
  createdAt: Date;
}

interface Props {
  members: TeamMember[];
  currentUserId: string;
}

export default function TeamActions({ members, currentUserId }: Props) {
  const router = useRouter();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AdminRole>("SUPPORT_ADMIN");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError("");
    setInviteSuccess("");
    const result = await inviteAdmin(inviteEmail.trim(), inviteRole);
    if (result.success) {
      setInviteSuccess(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      setTimeout(() => {
        setShowInviteModal(false);
        setInviteSuccess("");
      }, 2000);
    } else {
      setInviteError(
        result.error ?? "The invitation couldn't be sent. Please try again.",
      );
    }
    setInviting(false);
  }

  async function handleChangeRole(
    memberId: string,
    memberName: string,
    currentRole: AdminRole,
    newRole: AdminRole,
  ) {
    if (newRole === currentRole) return;
    if (
      !confirm(
        `Change ${memberName} from ${getRoleDisplayName(currentRole)} to ${getRoleDisplayName(newRole)}?`,
      )
    )
      return;
    setActionLoading(memberId + "_role");
    setActionError("");
    const result = await changeAdminRole(memberId, newRole);
    if (!result.success)
      setActionError(
        result.error ?? "The role couldn't be updated. Please try again.",
      );
    else router.refresh();
    setActionLoading(null);
  }

  async function handleRevoke(memberId: string, memberName: string) {
    if (
      !confirm(
        `Revoke admin access for ${memberName}? They will lose all admin permissions immediately.`,
      )
    )
      return;
    setActionLoading(memberId + "_revoke");
    setActionError("");
    const result = await revokeAdminAccess(memberId);
    if (!result.success)
      setActionError(
        result.error ?? "Access couldn't be revoked. Please try again.",
      );
    else router.refresh();
    setActionLoading(null);
  }

  return (
    <>
      {/* Header row with invite button */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold text-[#141414]">
            Team Management
          </h1>
          <p className="text-[13px] text-[#9E9A91] mt-0.5">
            {members.length} admin{members.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="px-4 py-2.5 rounded-xl bg-[#141414] text-white text-[13px] font-semibold hover:bg-[#2a2a2a] transition-colors"
        >
          + Invite Team Member
        </button>
      </div>

      {actionError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">
          {actionError}
        </div>
      )}

      {/* Members table */}
      <div className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-[#F0EDE8] bg-[#FAFAF8]">
                {["Name", "Email", "Role", "Member Since", "Actions"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F8F7F4]">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-[#FAFAF8] transition-colors">
                  <td className="px-5 py-3 font-semibold text-[#141414]">
                    {m.displayName}
                    {m.id === currentUserId && (
                      <span className="ml-2 text-[10px] text-[#9E9A91]">
                        (you)
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-[#73706A]">{m.email}</td>
                  <td className="px-5 py-3">
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                      style={{ background: getRoleBadgeColor(m.adminRole) }}
                    >
                      {getRoleDisplayName(m.adminRole)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-[#9E9A91] whitespace-nowrap">
                    {new Date(m.createdAt).toLocaleDateString("en-NZ", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-5 py-3">
                    {m.id === currentUserId ? (
                      <span className="text-[11px] text-[#C9C5BC]">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <select
                          value={m.adminRole}
                          onChange={(e) =>
                            handleChangeRole(
                              m.id,
                              m.displayName,
                              m.adminRole,
                              e.target.value as AdminRole,
                            )
                          }
                          disabled={actionLoading === m.id + "_role"}
                          className="h-7 px-2 rounded-lg border border-[#E3E0D9] text-[11px] text-[#141414] bg-white focus:outline-none focus:border-[#D4A843] disabled:opacity-50"
                        >
                          {ALL_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {getRoleDisplayName(r)}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleRevoke(m.id, m.displayName)}
                          disabled={actionLoading === m.id + "_revoke"}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                        >
                          {actionLoading === m.id + "_revoke" ? "…" : "Revoke"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6 w-full max-w-md mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
                Invite Team Member
              </h2>
              <button
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteError("");
                  setInviteSuccess("");
                }}
                className="text-[#9E9A91] hover:text-[#141414] transition-colors text-lg leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#73706A] mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@example.com"
                  className="w-full h-10 px-3 rounded-xl border border-[#C9C5BC] text-[13px] text-[#141414] focus:outline-none focus:border-[#D4A843]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#73706A] mb-1.5">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as AdminRole)}
                  className="w-full h-10 px-3 rounded-xl border border-[#C9C5BC] text-[13px] text-[#141414] bg-white focus:outline-none focus:border-[#D4A843]"
                >
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {getRoleDisplayName(r)} — {ROLE_DESCRIPTIONS[r]}
                    </option>
                  ))}
                </select>
              </div>

              {inviteError && (
                <p className="text-[12px] text-red-600">{inviteError}</p>
              )}
              {inviteSuccess && (
                <p className="text-[12px] text-green-600">{inviteSuccess}</p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowInviteModal(false)}
                  className="flex-1 h-10 rounded-xl border border-[#E3E0D9] text-[13px] font-semibold text-[#73706A] hover:border-[#141414] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  className="flex-1 h-10 rounded-xl bg-[#141414] text-white text-[13px] font-semibold hover:bg-[#2a2a2a] transition-colors disabled:opacity-50"
                >
                  {inviting ? "Sending…" : "Send Invitation →"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
