"use client";
// src/app/(protected)/admin/users/page.tsx  (Sprint 7)
// ─── Admin User Management ────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";
import { useSessionSafe } from "@/hooks/useSessionSafe";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  banUser,
  unbanUser,
  toggleSellerEnabled,
} from "@/server/actions/admin";

interface AdminUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  region: string | null;
  isSellerEnabled: boolean;
  idVerified: boolean;
  isBanned: boolean;
  createdAt: string;
  _count: { listings: number; buyerOrders: number };
}

export default function AdminUsersPage() {
  const { data: session, status } = useSessionSafe();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  const isAdmin = session?.user?.isAdmin;

  useEffect(() => {
    if (status === "authenticated" && !isAdmin)
      router.replace("/dashboard/buyer");
  }, [status, isAdmin, router]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), q: search });
      const res = await fetch(`/api/admin/users?${params}`);
      if (res.ok) {
        const json = (await res.json()) as {
          success: boolean;
          data?: { users: AdminUser[] };
        };
        setUsers(json.data?.users ?? []);
      } else {
        setUsers([]);
      }
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (isAdmin) fetchUsers();
  }, [isAdmin, fetchUsers]);

  async function handleBan(userId: string, currentlyBanned: boolean) {
    setActionLoading(userId);
    setError("");
    const result = currentlyBanned
      ? await unbanUser(userId)
      : await banUser(userId, "Banned by admin via dashboard");
    if (!result.success) setError(result.error);
    else fetchUsers();
    setActionLoading(null);
  }

  async function handleToggleSeller(userId: string) {
    setActionLoading(userId + "_seller");
    setError("");
    const result = await toggleSellerEnabled(userId);
    if (!result.success) setError(result.error);
    else fetchUsers();
    setActionLoading(null);
  }

  if (status === "loading" || !isAdmin) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      <div className="bg-[#141414] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
            <Link href="/admin" className="hover:text-white">
              Admin
            </Link>
            <span>/</span>
            <span className="text-white">Users</span>
          </div>
          <h1 className="font-[family-name:var(--font-playfair)] text-[1.5rem] font-semibold">
            User Management
          </h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">
            {error}
          </div>
        )}

        {/* Search */}
        <div className="mb-4 flex gap-3">
          <input
            type="search"
            placeholder="Search by email or username…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="flex-1 h-10 px-4 rounded-xl border border-[#C9C5BC] bg-white
                text-[13px] text-[#141414] focus:outline-none focus:border-[#D4A843]"
          />
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-[#9E9A91] text-[13px]">
              Loading users…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#F0EDE8] bg-[#FAFAF8]">
                    {[
                      "Username",
                      "Email",
                      "Region",
                      "Seller",
                      "Verified",
                      "Banned",
                      "Listings",
                      "Orders",
                      "Joined",
                      "Actions",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-[11px] font-semibold text-[#9E9A91] uppercase tracking-wide whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F8F7F4]">
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className={`hover:bg-[#FAFAF8] transition-colors ${u.isBanned ? "opacity-60" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium text-[#141414]">
                        @{u.username}
                      </td>
                      <td className="px-4 py-3 text-[#73706A]">{u.email}</td>
                      <td className="px-4 py-3 text-[#73706A]">
                        {u.region ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            u.isSellerEnabled
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-[#F8F7F4] text-[#9E9A91]"
                          }`}
                        >
                          {u.isSellerEnabled ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            u.idVerified
                              ? "bg-[#F5ECD4] text-[#8B6914]"
                              : "bg-[#F8F7F4] text-[#9E9A91]"
                          }`}
                        >
                          {u.idVerified ? "✓" : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            u.isBanned
                              ? "bg-red-50 text-red-700"
                              : "bg-[#F8F7F4] text-[#9E9A91]"
                          }`}
                        >
                          {u.isBanned ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#73706A]">
                        {u._count.listings}
                      </td>
                      <td className="px-4 py-3 text-[#73706A]">
                        {u._count.buyerOrders}
                      </td>
                      <td className="px-4 py-3 text-[#9E9A91] whitespace-nowrap">
                        {new Date(u.createdAt).toLocaleDateString("en-NZ", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleBan(u.id, u.isBanned)}
                            disabled={actionLoading === u.id}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                              u.isBanned
                                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                : "bg-red-50 text-red-700 hover:bg-red-100"
                            } disabled:opacity-50`}
                          >
                            {actionLoading === u.id
                              ? "…"
                              : u.isBanned
                                ? "Unban"
                                : "Ban"}
                          </button>
                          <button
                            onClick={() => handleToggleSeller(u.id)}
                            disabled={actionLoading === u.id + "_seller"}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold
                                bg-[#F5ECD4] text-[#8B6914] hover:bg-[#EDD98A]/40 transition-colors
                                disabled:opacity-50"
                          >
                            {actionLoading === u.id + "_seller"
                              ? "…"
                              : u.isSellerEnabled
                                ? "Disable seller"
                                : "Enable seller"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-4 py-12 text-center text-[#9E9A91]"
                      >
                        No users found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="flex justify-center gap-3 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 rounded-xl border border-[#E3E0D9] text-[12.5px]
                font-semibold text-[#141414] disabled:opacity-40 hover:border-[#141414]
                transition-colors"
          >
            Previous
          </button>
          <span className="flex items-center text-[12.5px] text-[#73706A]">
            Page {page}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={users.length < 20}
            className="px-4 py-2 rounded-xl border border-[#E3E0D9] text-[12.5px]
                font-semibold text-[#141414] disabled:opacity-40 hover:border-[#141414]
                transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
