"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/primitives";
import { relativeTime } from "@/lib/utils";
import { replyToReview } from "@/server/actions/reviews";
import { getTagConfig } from "@/lib/review-tags";
import type { ReviewTagType } from "@/lib/review-tags";

interface SellerReviewRow {
  id: string;
  buyerName: string;
  rating: number;
  comment: string;
  listingTitle: string;
  createdAt: string;
  sellerReply: string | null;
  tags?: string[];
}

interface Props {
  sellerId: string;
}

export default function SellerDashboardReviews({ sellerId }: Props) {
  const [reviews, setReviews] = useState<SellerReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyId, setReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);

  useEffect(() => {
    async function loadReviews() {
      try {
        const { fetchSellerReviews } =
          await import("@/server/actions/sellerReviews");
        const result = await fetchSellerReviews();
        if (result.success) {
          setReviews(result.data);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    loadReviews();
  }, [sellerId]);

  async function handleReply(reviewId: string) {
    if (!replyText.trim()) return;
    setReplyLoading(true);
    const result = await replyToReview({ reviewId, reply: replyText });
    if (result.success) {
      setReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId ? { ...r, sellerReply: replyText } : r,
        ),
      );
      setReplyId(null);
      setReplyText("");
    }
    setReplyLoading(false);
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1].map((i) => (
          <div
            key={i}
            className="bg-white rounded-2xl border border-[#E3E0D9] h-32"
          />
        ))}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-[#C9C5BC] p-12 text-center">
        <p className="text-[14px] text-[#9E9A91]">No reviews yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reviews.map((review) => (
        <article
          key={review.id}
          className="bg-white rounded-2xl border border-[#E3E0D9] p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[13px] font-semibold text-[#141414]">
                  {review.buyerName}
                </p>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <svg
                      key={s}
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill={s <= review.rating ? "#D4A843" : "none"}
                      stroke={s <= review.rating ? "#D4A843" : "#C9C5BC"}
                      strokeWidth="1.5"
                    >
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  ))}
                </div>
              </div>
              <p className="text-[12px] text-[#9E9A91] mb-2">
                {review.listingTitle} · {relativeTime(review.createdAt)}
              </p>
            </div>
          </div>

          <p className="text-[13px] text-[#141414] leading-relaxed">
            {review.comment}
          </p>

          {/* Buyer-selected strength tags */}
          {review.tags && review.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {review.tags.map((tag) => {
                const config = getTagConfig(tag as ReviewTagType);
                if (!config) return null;
                return (
                  <span
                    key={tag}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium border ${config.colour}`}
                  >
                    {config.emoji} {config.label}
                  </span>
                );
              })}
            </div>
          )}

          {review.sellerReply ? (
            <div className="mt-3 bg-[#F8F7F4] rounded-xl p-3 border-l-2 border-[#D4A843]">
              <p className="text-[11.5px] font-semibold text-[#141414] mb-1">
                Your reply
              </p>
              <p className="text-[12.5px] text-[#73706A]">
                {review.sellerReply}
              </p>
            </div>
          ) : replyId === review.id ? (
            <div className="mt-3 space-y-2">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write your reply..."
                rows={3}
                maxLength={500}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px] text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2 focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
              />
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleReply(review.id)}
                  loading={replyLoading}
                >
                  Post reply
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setReplyId(null);
                    setReplyText("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setReplyId(review.id)}
              className="mt-3 text-[12px] font-semibold text-[#D4A843] hover:text-[#B8912E] transition-colors"
            >
              Reply to review →
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
