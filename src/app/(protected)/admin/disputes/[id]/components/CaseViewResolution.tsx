"use client";
// src/app/(protected)/admin/disputes/[id]/components/CaseViewResolution.tsx
// ─── Section I: SOP guidance + resolved state + ResolutionActions ────────────

import { useState } from "react";
import { Section } from "./case-view-shared";
import { SOP, formatDate } from "./case-view-types";
import { toCents } from "@/lib/currency";
import type { AutoResolution, DisputeData } from "./case-view-types";
import {
  resolveDispute,
  resolveDisputePartialRefund,
  overrideAutoResolution,
  requestMoreInfo,
  flagUserForFraud,
} from "@/server/actions/admin";

// ── Form panel sub-components ─────────────────────────────────────────────────

function PartialRefundPanel({
  maxRefund,
  partialAmount,
  reason,
  loading,
  onAmountChange,
  onReasonChange,
  onSubmit,
  onCancel,
}: {
  maxRefund: number;
  partialAmount: string;
  reason: string;
  loading: string | null;
  onAmountChange: (v: string) => void;
  onReasonChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 bg-amber-50 rounded-xl p-3 border border-amber-200">
      <p className="text-[11px] font-semibold text-amber-700">
        Partial Refund (max ${maxRefund.toFixed(2)})
      </p>
      <input
        type="number"
        step="0.01"
        min="0.01"
        max={maxRefund}
        value={partialAmount}
        onChange={(e) => onAmountChange(e.target.value)}
        placeholder="Amount in NZD"
        className="w-full border border-amber-300 rounded-lg p-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-400/40"
      />
      <textarea
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        placeholder="Reason..."
        className="w-full border border-amber-300 rounded-lg p-2 text-[12px] resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/40"
        rows={2}
      />
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={loading !== null}
          className="flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {loading === "partial" ? "..." : "Issue Partial Refund"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-white text-[#73706A] border border-[#E3E0D9]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function RequestInfoPanel({
  infoTarget,
  infoMessage,
  loading,
  onTargetChange,
  onMessageChange,
  onSubmit,
  onCancel,
}: {
  infoTarget: "buyer" | "seller" | "both";
  infoMessage: string;
  loading: string | null;
  onTargetChange: (v: "buyer" | "seller" | "both") => void;
  onMessageChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 bg-sky-50 rounded-xl p-3 border border-sky-200">
      <p className="text-[11px] font-semibold text-sky-700">
        Request more information
      </p>
      <select
        value={infoTarget}
        onChange={(e) =>
          onTargetChange(e.target.value as "buyer" | "seller" | "both")
        }
        className="w-full border border-sky-300 rounded-lg p-2 text-[12px] focus:outline-none"
      >
        <option value="buyer">Send to buyer</option>
        <option value="seller">Send to seller</option>
        <option value="both">Send to both</option>
      </select>
      <textarea
        value={infoMessage}
        onChange={(e) => onMessageChange(e.target.value)}
        placeholder="What information do you need?..."
        className="w-full border border-sky-300 rounded-lg p-2 text-[12px] resize-none focus:outline-none"
        rows={3}
      />
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={loading !== null}
          className="flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {loading === "info" ? "..." : "Send Request"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-white text-[#73706A] border border-[#E3E0D9]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function FraudFlagPanel({
  fraudTarget,
  fraudReason,
  loading,
  onTargetChange,
  onReasonChange,
  onSubmit,
  onCancel,
}: {
  fraudTarget: "buyer" | "seller";
  fraudReason: string;
  loading: string | null;
  onTargetChange: (v: "buyer" | "seller") => void;
  onReasonChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 bg-red-50 rounded-xl p-3 border border-red-200">
      <p className="text-[11px] font-semibold text-red-700">
        Flag user for fraud
      </p>
      <select
        value={fraudTarget}
        onChange={(e) => onTargetChange(e.target.value as "buyer" | "seller")}
        className="w-full border border-red-300 rounded-lg p-2 text-[12px] focus:outline-none"
      >
        <option value="buyer">Flag buyer</option>
        <option value="seller">Flag seller</option>
      </select>
      <textarea
        value={fraudReason}
        onChange={(e) => onReasonChange(e.target.value)}
        placeholder="Reason for fraud flag..."
        className="w-full border border-red-300 rounded-lg p-2 text-[12px] resize-none focus:outline-none"
        rows={2}
      />
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={loading !== null}
          className="flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
        >
          {loading === "fraud" ? "..." : "Flag for Fraud"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-white text-[#73706A] border border-[#E3E0D9]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function OverridePanel({
  autoResolution,
  maxRefund,
  overrideDecision,
  overrideAmount,
  overrideReason,
  loading,
  onDecisionChange,
  onAmountChange,
  onReasonChange,
  onSubmit,
  onCancel,
}: {
  autoResolution: AutoResolution | null;
  maxRefund: number;
  overrideDecision: "refund" | "dismiss" | "partial_refund";
  overrideAmount: string;
  overrideReason: string;
  loading: string | null;
  onDecisionChange: (v: "refund" | "dismiss" | "partial_refund") => void;
  onAmountChange: (v: string) => void;
  onReasonChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 bg-purple-50 rounded-xl p-3 border border-purple-200">
      <p className="text-[11px] font-semibold text-purple-700">
        Override auto-resolution
      </p>
      <p className="text-[10.5px] text-purple-600">
        Current: {autoResolution?.decision?.replace(/_/g, " ")} (score:{" "}
        {autoResolution?.score})
      </p>
      <select
        value={overrideDecision}
        onChange={(e) =>
          onDecisionChange(
            e.target.value as "refund" | "dismiss" | "partial_refund",
          )
        }
        className="w-full border border-purple-300 rounded-lg p-2 text-[12px] focus:outline-none"
      >
        <option value="refund">Full refund to buyer</option>
        <option value="dismiss">Dismiss — seller's favour</option>
        <option value="partial_refund">Partial refund</option>
      </select>
      {overrideDecision === "partial_refund" && (
        <input
          type="number"
          step="0.01"
          min="0.01"
          max={maxRefund}
          value={overrideAmount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="Amount in NZD"
          className="w-full border border-purple-300 rounded-lg p-2 text-[12px] focus:outline-none"
        />
      )}
      <textarea
        value={overrideReason}
        onChange={(e) => onReasonChange(e.target.value)}
        placeholder="Reason for override..."
        className="w-full border border-purple-300 rounded-lg p-2 text-[12px] resize-none focus:outline-none"
        rows={2}
      />
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={loading !== null}
          className="flex-1 px-3 py-2 rounded-lg text-[12px] font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {loading === "override" ? "..." : "Apply Override"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-white text-[#73706A] border border-[#E3E0D9]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Resolution Actions ─────────────────────────────────────────────────────────

function ResolutionActions({
  orderId,
  totalNzd,
  buyerId,
  sellerId,
  autoResolution,
  onResolved,
}: {
  orderId: string;
  totalNzd: number;
  buyerId: string;
  sellerId: string;
  autoResolution: AutoResolution | null;
  onResolved: () => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showPartial, setShowPartial] = useState(false);
  const [showRequestInfo, setShowRequestInfo] = useState(false);
  const [showFraud, setShowFraud] = useState(false);
  const [showOverride, setShowOverride] = useState(false);

  // Form state
  const [reason, setReason] = useState("");
  const [partialAmount, setPartialAmount] = useState("");
  const [infoTarget, setInfoTarget] = useState<"buyer" | "seller" | "both">(
    "buyer",
  );
  const [infoMessage, setInfoMessage] = useState("");
  const [fraudTarget, setFraudTarget] = useState<"buyer" | "seller">("buyer");
  const [fraudReason, setFraudReason] = useState("");
  const [overrideDecision, setOverrideDecision] = useState<
    "refund" | "dismiss" | "partial_refund"
  >("refund");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideAmount, setOverrideAmount] = useState("");

  const isQueued = autoResolution?.status === "QUEUED";
  const maxRefund = totalNzd / 100;

  async function handleResolve(favour: "buyer" | "seller") {
    const label =
      favour === "buyer" ? "refund the buyer" : "release funds to seller";
    if (!reason.trim()) {
      setError("Please provide a reason for your decision.");
      return;
    }
    if (
      !confirm(
        `Are you sure you want to ${label}? This action processes the payment.`,
      )
    )
      return;
    setLoading(favour);
    setError("");
    const result = await resolveDispute(orderId, favour);
    setLoading(null);
    if (!result.success) {
      setError(result.error);
    } else {
      onResolved();
    }
  }

  async function handlePartialRefund() {
    const cents = toCents(parseFloat(partialAmount));
    if (!cents || cents <= 0 || cents > totalNzd) {
      setError(`Amount must be between $0.01 and $${maxRefund.toFixed(2)}.`);
      return;
    }
    if (!reason.trim()) {
      setError("Please provide a reason.");
      return;
    }
    setLoading("partial");
    setError("");
    const result = await resolveDisputePartialRefund({
      orderId,
      amountCents: cents,
      reason,
    });
    setLoading(null);
    if (!result.success) {
      setError(result.error);
    } else {
      onResolved();
    }
  }

  async function handleRequestInfo() {
    if (!infoMessage.trim() || infoMessage.length < 10) {
      setError("Message must be at least 10 characters.");
      return;
    }
    setLoading("info");
    setError("");
    const result = await requestMoreInfo({
      orderId,
      target: infoTarget,
      message: infoMessage,
    });
    setLoading(null);
    if (!result.success) {
      setError(result.error);
    } else {
      setShowRequestInfo(false);
      setInfoMessage("");
    }
  }

  async function handleFlagFraud() {
    if (!fraudReason.trim() || fraudReason.length < 10) {
      setError("Reason must be at least 10 characters.");
      return;
    }
    const userId = fraudTarget === "buyer" ? buyerId : sellerId;
    setLoading("fraud");
    setError("");
    const result = await flagUserForFraud({
      userId,
      orderId,
      reason: fraudReason,
    });
    setLoading(null);
    if (!result.success) {
      setError(result.error);
    } else {
      setShowFraud(false);
      setFraudReason("");
    }
  }

  async function handleOverride() {
    if (!overrideReason.trim()) {
      setError("Reason is required for override.");
      return;
    }
    const payload: Record<string, unknown> = {
      orderId,
      newDecision: overrideDecision,
      reason: overrideReason,
    };
    if (overrideDecision === "partial_refund") {
      const cents = toCents(parseFloat(overrideAmount));
      if (!cents || cents <= 0 || cents > totalNzd) {
        setError(`Amount must be between $0.01 and $${maxRefund.toFixed(2)}.`);
        return;
      }
      payload.partialAmountCents = cents;
    }
    setLoading("override");
    setError("");
    const result = await overrideAutoResolution(payload);
    setLoading(null);
    if (!result.success) {
      setError(result.error);
    } else {
      onResolved();
    }
  }

  return (
    <div className="space-y-3">
      {/* Reason field + main action buttons (shared, shown when no sub-panel open) */}
      {!showPartial && !showRequestInfo && !showFraud && !showOverride && (
        <>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for your decision (mandatory)..."
            className="w-full border border-[#E3E0D9] rounded-lg p-2.5 text-[12.5px] text-[#141414] placeholder-[#C9C5BC] resize-none focus:outline-none focus:ring-2 focus:ring-[#D4A843]/40"
            rows={2}
          />

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleResolve("buyer")}
              disabled={loading !== null}
              className="px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {loading === "buyer" ? "..." : "Full Refund to Buyer"}
            </button>
            <button
              onClick={() => setShowPartial(true)}
              disabled={loading !== null}
              className="px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
            >
              Partial Refund
            </button>
            <button
              onClick={() => handleResolve("seller")}
              disabled={loading !== null}
              className="px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-[#E3E0D9] text-[#141414] hover:bg-[#D5D2CB] transition-colors disabled:opacity-50"
            >
              {loading === "seller" ? "..." : "Dismiss — Seller's Favour"}
            </button>
            <button
              onClick={() => setShowRequestInfo(true)}
              disabled={loading !== null}
              className="px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-sky-500 text-white hover:bg-sky-600 transition-colors disabled:opacity-50"
            >
              Request More Info
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowFraud(true)}
              disabled={loading !== null}
              className="flex-1 px-3 py-2 rounded-xl text-[11.5px] font-semibold bg-red-100 text-red-700 hover:bg-red-200 transition-colors disabled:opacity-50"
            >
              Flag for Fraud
            </button>
            {isQueued && (
              <button
                onClick={() => setShowOverride(true)}
                disabled={loading !== null}
                className="flex-1 px-3 py-2 rounded-xl text-[11.5px] font-semibold bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors disabled:opacity-50"
              >
                Override Auto-Resolution
              </button>
            )}
          </div>
        </>
      )}

      {showPartial && (
        <PartialRefundPanel
          maxRefund={maxRefund}
          partialAmount={partialAmount}
          reason={reason}
          loading={loading}
          onAmountChange={setPartialAmount}
          onReasonChange={setReason}
          onSubmit={handlePartialRefund}
          onCancel={() => setShowPartial(false)}
        />
      )}

      {showRequestInfo && (
        <RequestInfoPanel
          infoTarget={infoTarget}
          infoMessage={infoMessage}
          loading={loading}
          onTargetChange={setInfoTarget}
          onMessageChange={setInfoMessage}
          onSubmit={handleRequestInfo}
          onCancel={() => setShowRequestInfo(false)}
        />
      )}

      {showFraud && (
        <FraudFlagPanel
          fraudTarget={fraudTarget}
          fraudReason={fraudReason}
          loading={loading}
          onTargetChange={setFraudTarget}
          onReasonChange={setFraudReason}
          onSubmit={handleFlagFraud}
          onCancel={() => setShowFraud(false)}
        />
      )}

      {showOverride && (
        <OverridePanel
          autoResolution={autoResolution}
          maxRefund={maxRefund}
          overrideDecision={overrideDecision}
          overrideAmount={overrideAmount}
          overrideReason={overrideReason}
          loading={loading}
          onDecisionChange={setOverrideDecision}
          onAmountChange={setOverrideAmount}
          onReasonChange={setOverrideReason}
          onSubmit={handleOverride}
          onCancel={() => setShowOverride(false)}
        />
      )}

      {error && (
        <p className="text-[11.5px] text-red-600 font-medium">{error}</p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  orderId: string;
  totalNzd: number;
  buyerId: string;
  sellerId: string;
  autoResolution: AutoResolution | null;
  dispute: DisputeData | null;
  isResolved: boolean;
  onResolved: () => void;
}

export default function CaseViewResolution({
  orderId,
  totalNzd,
  buyerId,
  sellerId,
  autoResolution,
  dispute,
  isResolved,
  onResolved,
}: Props) {
  return (
    <Section title="Resolution">
      {/* SOP Guidance */}
      {dispute?.reason && SOP[dispute.reason] && (
        <div className="bg-sky-50 rounded-lg p-3 border border-sky-200 mb-4">
          <p className="text-[10px] font-semibold text-sky-600 uppercase tracking-wider mb-1">
            Standard procedure
          </p>
          <p className="text-[12px] text-sky-800 leading-relaxed">
            {SOP[dispute.reason]}
          </p>
        </div>
      )}

      {isResolved ? (
        <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200 text-center">
          <p className="text-[13px] font-semibold text-emerald-700">
            This dispute has been resolved
          </p>
          <p className="text-[11px] text-emerald-600 mt-1">
            Resolved: {formatDate(dispute?.resolvedAt ?? null)}
          </p>
        </div>
      ) : (
        <ResolutionActions
          orderId={orderId}
          totalNzd={totalNzd}
          buyerId={buyerId}
          sellerId={sellerId}
          autoResolution={autoResolution}
          onResolved={onResolved}
        />
      )}
    </Section>
  );
}
