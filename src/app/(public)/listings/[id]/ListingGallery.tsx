'use client';
// src/app/(public)/listings/[id]/ListingGallery.tsx
// Image gallery with thumbnail strip, keyboard navigation, lightbox overlay.
// Sprint 3: images will arrive from Cloudflare R2 signed URLs — no changes needed.

import { useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import type { ListingImage } from '@/types';

interface Props {
  images: ListingImage[];
  title: string;
}

export default function ListingGallery({ images, title }: Props) {
  const [active, setActive] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const prev = useCallback(() => setActive((i) => (i - 1 + images.length) % images.length), [images.length]);
  const next = useCallback(() => setActive((i) => (i + 1) % images.length), [images.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxOpen, prev, next]);

  // Prevent body scroll when lightbox open
  useEffect(() => {
    document.body.style.overflow = lightboxOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [lightboxOpen]);

  if (!images.length) return null;

  return (
    <>
      {/* ── Main gallery ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#E3E0D9] overflow-hidden">
        {/* Primary image */}
        <div
          className="relative aspect-square sm:aspect-[4/3] cursor-zoom-in
            group bg-[#F8F7F4]"
          onClick={() => setLightboxOpen(true)}
          role="button"
          aria-label="Open full-screen image"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setLightboxOpen(true)}
        >
          <Image
            src={images[active].url}
            alt={images[active].altText || title}
            fill
            sizes="(max-width: 1024px) 100vw, 65vw"
            className="object-contain transition-transform duration-300 group-hover:scale-[1.02]"
            priority={active === 0}
          />

          {/* Zoom hint */}
          <div
            className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1
              bg-black/50 backdrop-blur-sm text-white text-[11px] font-medium
              rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            aria-hidden
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
            Enlarge
          </div>

          {/* Image counter */}
          {images.length > 1 && (
            <div
              className="absolute bottom-3 left-3 px-2.5 py-1 bg-black/50
                backdrop-blur-sm text-white text-[11px] font-medium rounded-full"
              aria-live="polite"
            >
              {active + 1} / {images.length}
            </div>
          )}

          {/* Prev / next arrows */}
          {images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); prev(); }}
                aria-label="Previous image"
                className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full
                  bg-white/90 backdrop-blur-sm border border-[#E3E0D9] shadow-sm
                  flex items-center justify-center opacity-0 group-hover:opacity-100
                  hover:bg-white transition-all duration-150"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="m15 18-6-6 6-6"/>
                </svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); next(); }}
                aria-label="Next image"
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full
                  bg-white/90 backdrop-blur-sm border border-[#E3E0D9] shadow-sm
                  flex items-center justify-center opacity-0 group-hover:opacity-100
                  hover:bg-white transition-all duration-150"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Thumbnail strip */}
        {images.length > 1 && (
          <div className="flex gap-2 p-3 overflow-x-auto scrollbar-none border-t border-[#F0EDE8]">
            {images.map((img, i) => (
              <button
                key={img.id}
                onClick={() => setActive(i)}
                aria-label={`View image ${i + 1}`}
                aria-pressed={i === active}
                className={`relative w-16 h-16 shrink-0 rounded-xl overflow-hidden
                  border-2 transition-all duration-150
                  ${i === active
                    ? 'border-[#D4A843] shadow-md'
                    : 'border-transparent opacity-60 hover:opacity-100 hover:border-[#C9C5BC]'
                  }`}
              >
                <Image
                  src={img.url}
                  alt={img.altText || `Image ${i + 1}`}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Lightbox overlay ─────────────────────────────────────────────── */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[9000] bg-black/95 flex items-center
            justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Image lightbox"
          onClick={() => setLightboxOpen(false)}
        >
          {/* Close button */}
          <button
            onClick={() => setLightboxOpen(false)}
            aria-label="Close lightbox"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10
              hover:bg-white/20 text-white flex items-center justify-center
              transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>

          {/* Image */}
          <div
            className="relative max-w-5xl w-full max-h-[85vh] aspect-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={images[active].url}
              alt={images[active].altText || title}
              width={1200}
              height={900}
              className="object-contain w-full h-full max-h-[85vh] rounded-xl"
            />
          </div>

          {/* Lightbox nav */}
          {images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); prev(); }}
                aria-label="Previous image"
                className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full
                  bg-white/10 hover:bg-white/20 text-white flex items-center
                  justify-center transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="m15 18-6-6 6-6"/>
                </svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); next(); }}
                aria-label="Next image"
                className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full
                  bg-white/10 hover:bg-white/20 text-white flex items-center
                  justify-content transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </button>
            </>
          )}

          {/* Counter */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-[12px]">
            {active + 1} / {images.length}
          </div>
        </div>
      )}
    </>
  );
}

