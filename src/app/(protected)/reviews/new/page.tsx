'use client';
// src/app/(protected)/reviews/new/page.tsx
// ─── New Review Page ────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import { Button, Alert } from '@/components/ui/primitives';
import { createReview } from '@/server/actions/reviews';
import { fetchOrderDetail } from '@/server/actions/orderDetail';

export default function NewReviewPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = searchParams.get('orderId');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderTitle, setOrderTitle] = useState('');

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!orderId) {
      setError('No order specified.');
      setLoading(false);
      return;
    }
    async function load() {
      const result = await fetchOrderDetail(orderId!);
      if (result.success) {
        setOrderTitle(result.data.listingTitle);
        if (result.data.hasReview) {
          setError('You have already reviewed this order.');
        }
        if (result.data.status !== 'completed') {
          setError('Reviews can only be left for completed orders.');
        }
      } else {
        setError(result.error);
      }
      setLoading(false);
    }
    load();
  }, [orderId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating === 0) {
      setError('Please select a rating.');
      return;
    }
    if (comment.length < 10) {
      setError('Please write at least 10 characters.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await createReview({
      orderId: orderId!,
      rating,
      comment,
    });

    if (result.success) {
      router.push('/dashboard/buyer?reviewSubmitted=true');
    } else {
      setError(result.error);
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <>
        <NavBar />
        <main className="bg-[#FAFAF8] min-h-screen">
          <div className="max-w-lg mx-auto px-4 py-12">
            <div className="animate-pulse bg-white rounded-2xl border border-[#E3E0D9] h-64" />
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <NavBar />
      <main className="bg-[#FAFAF8] min-h-screen">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-12">
          <nav className="flex items-center gap-2 text-[12.5px] text-[#9E9A91] mb-6">
            <Link href="/dashboard/buyer" className="hover:text-[#D4A843] transition-colors">
              Dashboard
            </Link>
            <span>/</span>
            <span className="text-[#141414] font-medium">Leave a review</span>
          </nav>

          <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold text-[#141414] mb-2">
            Leave a review
          </h1>
          {orderTitle && (
            <p className="text-[14px] text-[#73706A] mb-8">
              For: <strong className="text-[#141414]">{orderTitle}</strong>
            </p>
          )}

          {error && (
            <Alert variant="error" className="mb-6">{error}</Alert>
          )}

          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
            {/* Star rating */}
            <div className="mb-6">
              <label className="text-[12.5px] font-semibold text-[#141414] mb-3 block">
                Rating
              </label>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="transition-transform hover:scale-110"
                    aria-label={`${star} star${star > 1 ? 's' : ''}`}
                  >
                    <svg
                      width="32"
                      height="32"
                      viewBox="0 0 24 24"
                      fill={(hoverRating || rating) >= star ? '#D4A843' : 'none'}
                      stroke={(hoverRating || rating) >= star ? '#D4A843' : '#C9C5BC'}
                      strokeWidth="1.5"
                    >
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>
                ))}
              </div>
              {rating > 0 && (
                <p className="text-[12px] text-[#73706A] mt-2">
                  {['', 'Poor', 'Below average', 'Good', 'Very good', 'Excellent'][rating]}
                </p>
              )}
            </div>

            {/* Comment */}
            <div className="mb-6">
              <label className="text-[12.5px] font-semibold text-[#141414] mb-1.5 block">
                Your review
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Describe your experience with this purchase..."
                rows={5}
                maxLength={1000}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#C9C5BC] bg-white text-[13px]
                  text-[#141414] placeholder:text-[#C9C5BC] outline-none focus:ring-2
                  focus:ring-[#D4A843]/25 focus:border-[#D4A843] resize-none transition"
              />
              <p className="text-[11px] text-[#9E9A91] mt-1">
                {comment.length}/1000 characters (minimum 10)
              </p>
            </div>

            <Button
              type="submit"
              variant="gold"
              fullWidth
              size="lg"
              loading={submitting}
              disabled={rating === 0 || comment.length < 10}
            >
              Submit review
            </Button>
          </form>
        </div>
      </main>
      <Footer />
    </>
  );
}
