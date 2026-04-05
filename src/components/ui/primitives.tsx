// ─── KiwiMart — Shared UI Primitives ─────────────────────────────────────────
// These are the atomic building blocks used across all Sprint 2 pages.
// They will be replaced / augmented by shadcn/ui in Sprint 3 — but their
// prop signatures are intentionally identical to shadcn variants so that
// migration is a simple import path swap.
"use client";

import Link from "next/link";
import { forwardRef } from "react";
import type { Condition } from "@/types";
import { CONDITION_COLOURS, formatCondition } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Button
// ─────────────────────────────────────────────────────────────────────────────
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "gold";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  asChild?: boolean;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[#141414] text-white hover:bg-[#2a2a2a] focus-visible:ring-[#141414]",
  secondary:
    "bg-white text-[#141414] border border-[#C9C5BC] hover:border-[#141414] hover:bg-[#F8F7F4] focus-visible:ring-[#141414]",
  ghost:
    "bg-transparent text-[#73706A] hover:text-[#141414] hover:bg-[#F8F7F4] focus-visible:ring-[#141414]",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500",
  gold: "bg-[#D4A843] text-[#141414] hover:bg-[#B8912E] hover:text-white focus-visible:ring-[#D4A843] shadow-sm shadow-[#D4A843]/30",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-[12px] gap-1.5 rounded-lg",
  md: "h-10 px-5 text-[13.5px] gap-2 rounded-xl",
  lg: "h-12 px-7 text-[15px] gap-2.5 rounded-xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth = false,
      leftIcon,
      rightIcon,
      children,
      className = "",
      disabled,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center font-semibold tracking-[-0.01em]
        transition-all duration-150 cursor-pointer
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
        disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]
        ${BUTTON_VARIANTS[variant]}
        ${BUTTON_SIZES[size]}
        ${fullWidth ? "w-full" : ""}
        ${className}
      `}
      {...props}
    >
      {loading ? (
        <svg
          className="animate-spin"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  ),
);
Button.displayName = "Button";

// ─────────────────────────────────────────────────────────────────────────────
// Input
// ─────────────────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftAddon?: React.ReactNode;
  rightAddon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { label, error, hint, leftAddon, rightAddon, className = "", id, ...props },
    ref,
  ) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-[12.5px] font-semibold text-[#141414]"
          >
            {label}
            {props.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
        )}
        <div className="relative flex items-center">
          {leftAddon && (
            <div className="absolute left-3 text-[#9E9A91] pointer-events-none">
              {leftAddon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={`
              w-full h-10 px-3.5 rounded-xl border bg-white text-[13.5px] text-[#141414]
              placeholder:text-[#C9C5BC] outline-none transition
              focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843]
              disabled:bg-[#F8F7F4] disabled:cursor-not-allowed
              ${error ? "border-red-400 focus:border-red-400 focus:ring-red-200/50" : "border-[#C9C5BC]"}
              ${leftAddon ? "pl-9" : ""}
              ${rightAddon ? "pr-9" : ""}
              ${className}
            `}
            {...props}
          />
          {rightAddon && (
            <div className="absolute right-3 text-[#9E9A91]">{rightAddon}</div>
          )}
        </div>
        {error && (
          <p className="text-[11.5px] text-red-500 font-medium">{error}</p>
        )}
        {hint && !error && (
          <p className="text-[11.5px] text-[#9E9A91]">{hint}</p>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

// ─────────────────────────────────────────────────────────────────────────────
// Textarea
// ─────────────────────────────────────────────────────────────────────────────
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  charCount?: { current: number; max: number };
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, charCount, className = "", id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <div className="flex items-center justify-between">
            <label
              htmlFor={inputId}
              className="text-[12.5px] font-semibold text-[#141414]"
            >
              {label}
              {props.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {charCount && (
              <span
                className={`text-[11px] ${charCount.current > charCount.max * 0.9 ? "text-amber-600" : "text-[#9E9A91]"}`}
              >
                {charCount.current}/{charCount.max}
              </span>
            )}
          </div>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={`
            w-full px-3.5 py-2.5 rounded-xl border bg-white text-[13.5px] text-[#141414]
            placeholder:text-[#C9C5BC] outline-none transition resize-y min-h-[100px]
            focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843]
            disabled:bg-[#F8F7F4] disabled:cursor-not-allowed leading-relaxed
            ${error ? "border-red-400" : "border-[#C9C5BC]"}
            ${className}
          `}
          {...props}
        />
        {error && (
          <p className="text-[11.5px] text-red-500 font-medium">{error}</p>
        )}
        {hint && !error && (
          <p className="text-[11.5px] text-[#9E9A91]">{hint}</p>
        )}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";

// ─────────────────────────────────────────────────────────────────────────────
// Select
// ─────────────────────────────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    { label, error, hint, placeholder, className = "", id, children, ...props },
    ref,
  ) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-[12.5px] font-semibold text-[#141414]"
          >
            {label}
            {props.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={inputId}
            className={`
              w-full h-10 pl-3.5 pr-9 rounded-xl border bg-white text-[13.5px] text-[#141414]
              appearance-none outline-none cursor-pointer transition
              focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843]
              disabled:bg-[#F8F7F4] disabled:cursor-not-allowed
              ${error ? "border-red-400" : "border-[#C9C5BC]"}
              ${className}
            `}
            {...props}
          >
            {placeholder && <option value="">{placeholder}</option>}
            {children}
          </select>
          <svg
            aria-hidden
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9E9A91] pointer-events-none"
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
        {error && (
          <p className="text-[11.5px] text-red-500 font-medium">{error}</p>
        )}
        {hint && !error && (
          <p className="text-[11.5px] text-[#9E9A91]">{hint}</p>
        )}
      </div>
    );
  },
);
Select.displayName = "Select";

// ─────────────────────────────────────────────────────────────────────────────
// ConditionBadge
// ─────────────────────────────────────────────────────────────────────────────
export function ConditionBadge({
  condition,
  size = "sm",
}: {
  condition: Condition | string;
  size?: "sm" | "md";
}) {
  // Accept Prisma enum values ("LIKE_NEW"), legacy kebab ("like-new"),
  // or snake_case — normalise to the kebab key used by CONDITION_COLOURS.
  const normalized = String(condition)
    .toLowerCase()
    .replace(/_/g, "-") as Condition;
  const colour =
    CONDITION_COLOURS[normalized] ??
    "bg-[#F8F7F4] text-[#73706A] ring-[#C9C5BC]";
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold tracking-wide ring-1
        ${colour}
        ${size === "sm" ? "px-2 py-0.5 text-[10.5px]" : "px-3 py-1 text-[12px]"}
      `}
    >
      {formatCondition(condition)}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OrderStatusBadge
// ─────────────────────────────────────────────────────────────────────────────
import type { OrderStatus } from "@/types";

const ORDER_STATUS_STYLES: Record<OrderStatus, string> = {
  awaiting_payment: "bg-amber-50 text-amber-700 ring-amber-200",
  payment_held: "bg-sky-50 text-sky-700 ring-sky-200",
  dispatched: "bg-blue-50 text-blue-700 ring-blue-200",
  delivered: "bg-violet-50 text-violet-700 ring-violet-200",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  disputed: "bg-red-50 text-red-700 ring-red-200",
  refunded: "bg-orange-50 text-orange-700 ring-orange-200",
  cancelled: "bg-[#F8F7F4] text-[#73706A] ring-[#C9C5BC]",
};

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: "Awaiting payment",
  payment_held: "Payment held",
  dispatched: "Dispatched",
  delivered: "Delivered",
  completed: "Completed",
  disputed: "In dispute",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px]
        font-semibold ring-1 ${ORDER_STATUS_STYLES[status]}`}
    >
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Avatar
// ─────────────────────────────────────────────────────────────────────────────
export function Avatar({
  name,
  src,
  size = "md",
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizes = {
    sm: "w-7 h-7 text-[11px]",
    md: "w-10 h-10 text-[14px]",
    lg: "w-14 h-14 text-[18px]",
    xl: "w-20 h-20 text-[24px]",
  };
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`${sizes[size]} rounded-full object-cover shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sizes[size]} rounded-full bg-[#141414] text-white font-bold
        flex items-center justify-center shrink-0 select-none ${className}`}
      aria-label={name}
    >
      {initials}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Breadcrumb
// ─────────────────────────────────────────────────────────────────────────────
interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center flex-wrap gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <svg
                aria-hidden
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="text-[#C9C5BC]"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            )}
            {item.href && i < items.length - 1 ? (
              <Link
                href={item.href}
                className="text-[12px] text-[#73706A] hover:text-[#141414] transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={`text-[12px] ${i === items.length - 1 ? "text-[#141414] font-medium" : "text-[#73706A]"}`}
                aria-current={i === items.length - 1 ? "page" : undefined}
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StarRating
// ─────────────────────────────────────────────────────────────────────────────
export function StarRating({
  rating,
  reviewCount,
  size = "sm",
  showCount = true,
}: {
  rating: number;
  reviewCount?: number;
  size?: "sm" | "md";
  showCount?: boolean;
}) {
  const full = Math.floor(rating);
  const hasHalf = rating % 1 >= 0.5;
  const empty = 5 - full - (hasHalf ? 1 : 0);
  const starSize = size === "sm" ? 13 : 16;

  return (
    <div className="flex items-center gap-1.5">
      <div
        className="flex items-center gap-0.5"
        aria-label={`${rating} out of 5 stars`}
      >
        {Array.from({ length: full }).map((_, i) => (
          <svg
            key={`f${i}`}
            width={starSize}
            height={starSize}
            viewBox="0 0 24 24"
            fill="#D4A843"
          >
            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
          </svg>
        ))}
        {hasHalf && (
          <svg width={starSize} height={starSize} viewBox="0 0 24 24">
            <defs>
              <linearGradient id="half">
                <stop offset="50%" stopColor="#D4A843" />
                <stop offset="50%" stopColor="#E3E0D9" />
              </linearGradient>
            </defs>
            <polygon
              points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
              fill="url(#half)"
            />
          </svg>
        )}
        {Array.from({ length: empty }).map((_, i) => (
          <svg
            key={`e${i}`}
            width={starSize}
            height={starSize}
            viewBox="0 0 24 24"
            fill="#E3E0D9"
          >
            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
          </svg>
        ))}
      </div>
      <span
        className={`font-semibold text-[#141414] ${size === "sm" ? "text-[12.5px]" : "text-[14px]"}`}
      >
        {rating.toFixed(1)}
      </span>
      {showCount && reviewCount !== undefined && (
        <span
          className={`text-[#9E9A91] ${size === "sm" ? "text-[11.5px]" : "text-[13px]"}`}
        >
          ({reviewCount.toLocaleString("en-NZ")})
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert / InlineAlert
// ─────────────────────────────────────────────────────────────────────────────
type AlertVariant = "info" | "success" | "warning" | "error";

const ALERT_STYLES: Record<AlertVariant, string> = {
  info: "bg-sky-50 border-sky-200 text-sky-800",
  success: "bg-emerald-50 border-emerald-200 text-emerald-800",
  warning: "bg-amber-50 border-amber-200 text-amber-800",
  error: "bg-red-50 border-red-200 text-red-800",
};

const ALERT_ICONS: Record<AlertVariant, React.ReactNode> = {
  info: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  success: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  warning: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  error: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
};

export function Alert({
  variant = "info",
  title,
  children,
  className = "",
}: {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex gap-3 px-4 py-3 rounded-xl border text-[13px] leading-relaxed
        ${ALERT_STYLES[variant]} ${className}`}
    >
      <span className="shrink-0 mt-0.5">{ALERT_ICONS[variant]}</span>
      <div>
        {title && <p className="font-semibold mb-0.5">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Divider
// ─────────────────────────────────────────────────────────────────────────────
export function Divider({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  if (label) {
    return (
      <div
        className={`relative flex items-center gap-3 my-2${className ? ` ${className}` : ""}`}
      >
        <div className="flex-1 h-px bg-[#E3E0D9]" />
        <span className="text-[11.5px] text-[#9E9A91] font-medium shrink-0">
          {label}
        </span>
        <div className="flex-1 h-px bg-[#E3E0D9]" />
      </div>
    );
  }
  return (
    <hr
      className={`border-[#E3E0D9] my-2${className ? ` ${className}` : ""}`}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PasswordStrength
// ─────────────────────────────────────────────────────────────────────────────
export function PasswordStrength({ password }: { password: string }) {
  const checks = [
    password.length >= 12,
    /[A-Z]/.test(password) && /[a-z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;

  const levels = [
    { label: "", colour: "bg-[#E3E0D9]" },
    { label: "Weak", colour: "bg-red-500" },
    { label: "Fair", colour: "bg-amber-500" },
    { label: "Good", colour: "bg-sky-500" },
    { label: "Strong", colour: "bg-emerald-500" },
  ];
  const level = levels[score];

  if (!password) return null;

  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-300
              ${i <= score ? (level?.colour ?? "") : "bg-[#E3E0D9]"}`}
          />
        ))}
      </div>
      {level?.label && (
        <p
          className={`text-[11px] font-semibold ${
            score === 1
              ? "text-red-600"
              : score === 2
                ? "text-amber-600"
                : score === 3
                  ? "text-sky-600"
                  : "text-emerald-600"
          }`}
        >
          {level?.label} password
        </p>
      )}
    </div>
  );
}
