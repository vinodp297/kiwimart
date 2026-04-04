"use client";
// src/app/(protected)/admin/disputes/[id]/components/CaseViewHeader.tsx
// ─── Right column: F (System Analysis) + G (Inconsistency Alerts)
// ─── + H (Trust Profiles) + business seller notice ───────────────────────────

import { Section } from "./case-view-shared";
import { fmtDate } from "./case-view-types";
import type {
  AutoResolution,
  Inconsistency,
  DisputeData,
  CaseData,
} from "./case-view-types";

// ── Profile Card ──────────────────────────────────────────────────────────────

function ProfileCard({
  label,
  name,
  email,
  memberSince,
  idVerified,
  stats,
  isFlagged,
}: {
  label: string;
  name: string;
  email: string;
  memberSince: string;
  idVerified?: boolean;
  stats: Array<{ label: string; value: string | number; alert?: boolean }>;
  isFlagged: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-3 border ${
        isFlagged ? "bg-red-50 border-red-200" : "bg-[#F8F7F4] border-[#E3E0D9]"
      }`}
    >
      <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-1.5">
        {label}
        {isFlagged && (
          <span className="ml-1.5 text-red-600">🚩 Fraud flagged</span>
        )}
      </p>
      <p className="text-[13px] font-semibold text-[#141414] truncate">
        {name}
        {idVerified && (
          <span className="ml-1 text-emerald-600 text-[10px]">✓ ID</span>
        )}
      </p>
      <p className="text-[11px] text-[#73706A] truncate">{email}</p>
      <p className="text-[10px] text-[#9E9A91] mt-0.5">Since {memberSince}</p>
      <div className="mt-2 grid grid-cols-2 gap-1">
        {stats.map(({ label: l, value, alert }) => (
          <div key={l} className="text-[10.5px]">
            <span className="text-[#9E9A91]">{l}: </span>
            <span
              className={`font-semibold ${alert ? "text-red-600" : "text-[#141414]"}`}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  autoResolution: AutoResolution | null;
  inconsistencies: Inconsistency[];
  buyer: CaseData["buyer"];
  seller: CaseData["seller"];
  dispute: DisputeData | null;
}

export default function CaseViewHeader({
  autoResolution,
  inconsistencies,
  buyer,
  seller,
  dispute,
}: Props) {
  return (
    <>
      {/* F: System Analysis */}
      {autoResolution && (
        <Section title="System analysis">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[#9E9A91] font-medium">
                Score:
              </span>
              <span
                className={`text-[1.5rem] font-bold font-[family-name:var(--font-playfair)] ${
                  autoResolution.score > 0
                    ? "text-emerald-700"
                    : autoResolution.score < 0
                      ? "text-red-700"
                      : "text-[#73706A]"
                }`}
              >
                {autoResolution.score >= 0 ? "+" : ""}
                {autoResolution.score}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  autoResolution.decision === "AUTO_REFUND"
                    ? "bg-emerald-50 text-emerald-700"
                    : autoResolution.decision === "AUTO_DISMISS"
                      ? "bg-sky-50 text-sky-700"
                      : autoResolution.decision === "FLAG_FRAUD"
                        ? "bg-red-50 text-red-700"
                        : "bg-amber-50 text-amber-700"
                }`}
              >
                {autoResolution.decision.replace(/_/g, " ")}
              </span>
            </div>

            {/* Factors */}
            <div className="space-y-1.5">
              {autoResolution.factors.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-[12px]">
                  <span
                    className={`font-mono font-bold w-[40px] text-right flex-shrink-0 ${
                      f.points > 0
                        ? "text-emerald-600"
                        : f.points < 0
                          ? "text-red-600"
                          : "text-[#9E9A91]"
                    }`}
                  >
                    {f.points > 0 ? "+" : ""}
                    {f.points}
                  </span>
                  <span className="text-[#73706A]">{f.description}</span>
                </div>
              ))}
            </div>

            {/* Recommendation */}
            <div className="bg-[#F8F7F4] rounded-lg p-3 border border-[#E3E0D9]">
              <p className="text-[12px] text-[#73706A] leading-relaxed">
                {autoResolution.recommendation}
              </p>
            </div>
          </div>
        </Section>
      )}

      {/* G: Inconsistency Alerts */}
      {inconsistencies.length > 0 && (
        <Section title="Inconsistency alerts">
          <div className="space-y-2">
            {inconsistencies.map((alert, i) => (
              <div
                key={i}
                className={`rounded-lg p-3 border text-[12px] leading-relaxed ${
                  alert.severity === "high"
                    ? "bg-red-50 border-red-200 text-red-800"
                    : alert.severity === "medium"
                      ? "bg-amber-50 border-amber-200 text-amber-800"
                      : "bg-[#F8F7F4] border-[#E3E0D9] text-[#73706A]"
                }`}
              >
                <span className="font-semibold">
                  {alert.severity === "high"
                    ? "🚨 "
                    : alert.severity === "medium"
                      ? "⚠️ "
                      : "ℹ️ "}
                </span>
                {alert.message}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* H: Buyer & Seller Profiles */}
      <Section title="Trust profiles">
        <div className="grid grid-cols-2 gap-3">
          <ProfileCard
            label="Buyer"
            name={buyer.displayName}
            email={buyer.email}
            memberSince={fmtDate(buyer.createdAt)}
            stats={[
              { label: "Orders", value: buyer.metrics.totalOrders },
              { label: "Disputes", value: buyer.metrics.disputeCount },
              {
                label: "Rate",
                value: `${buyer.metrics.disputeRate}%`,
                alert: buyer.metrics.disputeRate > 15,
              },
              {
                label: "Last 30d",
                value: buyer.metrics.disputesLast30Days,
                alert: buyer.metrics.disputesLast30Days > 3,
              },
            ]}
            isFlagged={buyer.metrics.isFlaggedForFraud}
          />
          <ProfileCard
            label="Seller"
            name={seller.displayName}
            email={seller.email}
            memberSince={fmtDate(seller.createdAt)}
            idVerified={seller.idVerified}
            stats={[
              { label: "Sales", value: seller.metrics.totalOrders },
              { label: "Disputes", value: seller.metrics.disputeCount },
              {
                label: "Rate",
                value: `${seller.metrics.disputeRate}%`,
                alert: seller.metrics.disputeRate > 15,
              },
              {
                label: "Rating",
                value: seller.metrics.averageRating
                  ? `${seller.metrics.averageRating}/5`
                  : "—",
              },
              {
                label: "Avg response",
                value: seller.metrics.averageResponseHours
                  ? `${Math.round(seller.metrics.averageResponseHours)}h`
                  : "—",
              },
              {
                label: "Photo rate",
                value: `${seller.metrics.dispatchPhotoRate}%`,
              },
            ]}
            isFlagged={seller.metrics.isFlaggedForFraud}
          />
        </div>
      </Section>

      {/* Business seller notice */}
      {seller.nzbn && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
          <span className="text-amber-600 text-sm mt-0.5">🏢</span>
          <div>
            <p className="text-[12px] font-semibold text-amber-800">
              Registered business seller (NZBN: {seller.nzbn})
            </p>
            <p className="text-[11px] text-amber-700 mt-0.5">
              Consumer Guarantees Act obligations apply — the buyer has stronger
              consumer rights.
              {dispute?.reason === "CHANGED_MIND" &&
                " CGA may require acceptance of returns for business sellers."}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
