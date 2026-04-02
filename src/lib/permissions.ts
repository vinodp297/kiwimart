// src/lib/permissions.ts
// ─── RBAC Permission Matrix ───────────────────────────────────────────────────

import type { AdminRole } from "@prisma/client";

// Every permission in the system
export type Permission =
  // Revenue & Finance
  | "VIEW_REVENUE"
  | "VIEW_TRANSACTIONS"
  | "VIEW_PAYOUTS"
  | "PROCESS_REFUNDS"
  | "EXPORT_FINANCIAL_REPORTS"
  // Disputes
  | "VIEW_DISPUTES"
  | "RESOLVE_DISPUTES"
  // Users
  | "VIEW_USERS"
  | "VIEW_USER_PII"
  | "BAN_USERS"
  | "UNBAN_USERS"
  // Content Moderation
  | "VIEW_REPORTS"
  | "MODERATE_CONTENT"
  | "REMOVE_LISTINGS"
  // Sellers
  | "VIEW_SELLERS"
  | "APPROVE_SELLERS"
  | "REJECT_SELLERS"
  | "VIEW_SELLER_PERFORMANCE"
  // System
  | "VIEW_AUDIT_LOGS"
  | "VIEW_SYSTEM_HEALTH"
  | "VIEW_ALL_METRICS"
  // Admin Management
  | "MANAGE_ADMIN_ROLES"
  | "INVITE_ADMINS"
  // Support
  | "VIEW_ORDER_DETAILS"
  | "ADD_ACCOUNT_NOTES"
  | "ESCALATE_DISPUTES"
  // Platform Config
  | "MANAGE_PLATFORM_CONFIG"
  | "VIEW_PLATFORM_CONFIG"
  // Dynamic Lists
  | "MANAGE_DYNAMIC_LISTS"
  | "VIEW_DYNAMIC_LISTS";

// Permission matrix — which roles have which permissions
export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  SUPER_ADMIN: [
    "VIEW_REVENUE",
    "VIEW_TRANSACTIONS",
    "VIEW_PAYOUTS",
    "PROCESS_REFUNDS",
    "EXPORT_FINANCIAL_REPORTS",
    "VIEW_DISPUTES",
    "RESOLVE_DISPUTES",
    "VIEW_USERS",
    "VIEW_USER_PII",
    "BAN_USERS",
    "UNBAN_USERS",
    "VIEW_REPORTS",
    "MODERATE_CONTENT",
    "REMOVE_LISTINGS",
    "VIEW_SELLERS",
    "APPROVE_SELLERS",
    "REJECT_SELLERS",
    "VIEW_SELLER_PERFORMANCE",
    "VIEW_AUDIT_LOGS",
    "VIEW_SYSTEM_HEALTH",
    "VIEW_ALL_METRICS",
    "MANAGE_ADMIN_ROLES",
    "INVITE_ADMINS",
    "VIEW_ORDER_DETAILS",
    "ADD_ACCOUNT_NOTES",
    "ESCALATE_DISPUTES",
    "MANAGE_PLATFORM_CONFIG",
    "VIEW_PLATFORM_CONFIG",
    "MANAGE_DYNAMIC_LISTS",
    "VIEW_DYNAMIC_LISTS",
  ],

  FINANCE_ADMIN: [
    "VIEW_REVENUE",
    "VIEW_TRANSACTIONS",
    "VIEW_PAYOUTS",
    "PROCESS_REFUNDS",
    "EXPORT_FINANCIAL_REPORTS",
    "VIEW_PLATFORM_CONFIG",
    "VIEW_DYNAMIC_LISTS",
  ],

  DISPUTES_ADMIN: [
    "VIEW_DISPUTES",
    "RESOLVE_DISPUTES",
    "VIEW_USER_PII",
    "VIEW_ORDER_DETAILS",
    "PROCESS_REFUNDS",
    "ADD_ACCOUNT_NOTES",
    "VIEW_PLATFORM_CONFIG",
    "VIEW_DYNAMIC_LISTS",
  ],

  TRUST_SAFETY_ADMIN: [
    "VIEW_USERS",
    "VIEW_USER_PII",
    "BAN_USERS",
    "UNBAN_USERS",
    "VIEW_REPORTS",
    "MODERATE_CONTENT",
    "REMOVE_LISTINGS",
    "ADD_ACCOUNT_NOTES",
    "VIEW_PLATFORM_CONFIG",
    "MANAGE_DYNAMIC_LISTS",
    "VIEW_DYNAMIC_LISTS",
  ],

  SUPPORT_ADMIN: [
    "VIEW_USERS",
    "VIEW_USER_PII",
    "VIEW_ORDER_DETAILS",
    "ADD_ACCOUNT_NOTES",
    "ESCALATE_DISPUTES",
    "VIEW_PLATFORM_CONFIG",
    "VIEW_DYNAMIC_LISTS",
  ],

  SELLER_MANAGER: [
    "VIEW_SELLERS",
    "APPROVE_SELLERS",
    "REJECT_SELLERS",
    "VIEW_SELLER_PERFORMANCE",
    "ADD_ACCOUNT_NOTES",
    "VIEW_PLATFORM_CONFIG",
    "VIEW_DYNAMIC_LISTS",
  ],

  READ_ONLY_ADMIN: [
    "VIEW_REVENUE",
    "VIEW_TRANSACTIONS",
    "VIEW_ALL_METRICS",
    "VIEW_SYSTEM_HEALTH",
    "VIEW_SELLER_PERFORMANCE",
    "EXPORT_FINANCIAL_REPORTS",
    "VIEW_PLATFORM_CONFIG",
    "VIEW_DYNAMIC_LISTS",
  ],
};

// Check if a role has a permission
export function hasPermission(
  role: AdminRole | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

// Check multiple permissions (must have ALL)
export function hasAllPermissions(
  role: AdminRole | null | undefined,
  permissions: Permission[],
): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

// Check multiple permissions (must have AT LEAST ONE)
export function hasAnyPermission(
  role: AdminRole | null | undefined,
  permissions: Permission[],
): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

// Get the display name for a role
export function getRoleDisplayName(role: AdminRole): string {
  const names: Record<AdminRole, string> = {
    SUPER_ADMIN: "Super Admin",
    FINANCE_ADMIN: "Finance Admin",
    DISPUTES_ADMIN: "Disputes Admin",
    TRUST_SAFETY_ADMIN: "Trust & Safety Admin",
    SUPPORT_ADMIN: "Support Admin",
    SELLER_MANAGER: "Seller Manager",
    READ_ONLY_ADMIN: "Read Only Admin",
  };
  return names[role];
}

// Get role badge color for UI
export function getRoleBadgeColor(role: AdminRole): string {
  const colors: Record<AdminRole, string> = {
    SUPER_ADMIN: "#141414",
    FINANCE_ADMIN: "#16a34a",
    DISPUTES_ADMIN: "#dc2626",
    TRUST_SAFETY_ADMIN: "#7c3aed",
    SUPPORT_ADMIN: "#1d4ed8",
    SELLER_MANAGER: "#D4A843",
    READ_ONLY_ADMIN: "#73706A",
  };
  return colors[role];
}
