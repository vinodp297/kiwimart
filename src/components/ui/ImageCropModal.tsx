"use client";
// src/components/ui/ImageCropModal.tsx
// ─── Image Crop Modal ─────────────────────────────────────────────────────────
// Lightweight canvas-based crop editor — no external dependencies.
//
// Avatar mode: 360×360 preview → 400×400 JPEG output (displayed as circle via CSS)
// Cover mode:  560×186 preview → 1200×400 JPEG output (wide banner)
//
// User interactions:
//   • Drag to pan the image within the crop frame
//   • Scroll wheel / slider to zoom (1× – 3×)
//   • Touch drag supported for mobile

import { useState, useRef, useEffect, useCallback } from "react";

export type CropMode = "avatar" | "cover";

interface Props {
  file: File;
  mode: CropMode;
  /** Called with the cropped JPEG blob when the user clicks Apply */
  onAccept: (blob: Blob) => void;
  onClose: () => void;
}

// Preview container dimensions and canvas output size for each mode
const CONFIG = {
  avatar: { cW: 320, cH: 320, outW: 400, outH: 400, label: "Profile photo" },
  cover: { cW: 560, cH: 186, outW: 1200, outH: 400, label: "Cover image" },
};

export function ImageCropModal({ file, mode, onAccept, onClose }: Props) {
  const { cW, cH, outW, outH, label } = CONFIG[mode];

  const [imgSrc, setImgSrc] = useState("");
  const [natW, setNatW] = useState(1);
  const [natH, setNatH] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  } | null>(null);
  const touchRef = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  } | null>(null);

  // Create an object URL for the chosen file
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    setImgLoaded(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Base scale so the image covers the preview container (like object-fit:cover) */
  const baseScale = useCallback(
    (nw: number, nh: number) => Math.max(cW / nw, cH / nh),
    [cW, cH],
  );

  /** Clamp pan offset so no white space appears at the edges */
  const clamp = useCallback(
    (ox: number, oy: number, z: number, nw: number, nh: number) => {
      const bs = baseScale(nw, nh);
      const dispW = nw * bs * z;
      const dispH = nh * bs * z;
      const maxX = Math.max(0, (dispW - cW) / 2);
      const maxY = Math.max(0, (dispH - cH) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, ox)),
        y: Math.max(-maxY, Math.min(maxY, oy)),
      };
    },
    [cW, cH, baseScale],
  );

  // ── Mouse drag ───────────────────────────────────────────────────────────────

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  };

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { sx, sy, ox, oy } = dragRef.current;
      setOffset(
        clamp(ox + (e.clientX - sx), oy + (e.clientY - sy), zoom, natW, natH),
      );
    },
    [zoom, natW, natH, clamp],
  );

  const onMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // ── Touch drag ───────────────────────────────────────────────────────────────

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchRef.current = {
      sx: t.clientX,
      sy: t.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const t = e.touches[0];
    if (!t) return;
    const { sx, sy, ox, oy } = touchRef.current;
    setOffset(
      clamp(ox + (t.clientX - sx), oy + (t.clientY - sy), zoom, natW, natH),
    );
  };

  const onTouchEnd = () => {
    touchRef.current = null;
  };

  // ── Scroll-to-zoom ───────────────────────────────────────────────────────────

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    const z = Math.max(1, Math.min(3, zoom + delta));
    setZoom(z);
    setOffset((prev) => clamp(prev.x, prev.y, z, natW, natH));
  };

  // ── Zoom slider ──────────────────────────────────────────────────────────────

  const onZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const z = parseFloat(e.target.value);
    setZoom(z);
    setOffset((prev) => clamp(prev.x, prev.y, z, natW, natH));
  };

  // ── Crop & output ────────────────────────────────────────────────────────────

  const handleAccept = () => {
    const img = imgRef.current;
    if (!img || !natW || !natH) return;

    const bs = baseScale(natW, natH);
    const dispW = natW * bs * zoom;
    const dispH = natH * bs * zoom;

    // Top-left of the displayed image inside the preview container
    const imgLeft = cW / 2 + offset.x - dispW / 2;
    const imgTop = cH / 2 + offset.y - dispH / 2;

    // Corresponding source rectangle in natural-image coordinates
    const scaleX = natW / dispW;
    const scaleY = natH / dispH;
    const srcX = -imgLeft * scaleX;
    const srcY = -imgTop * scaleY;
    const srcW = cW * scaleX;
    const srcH = cH * scaleY;

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
    canvas.toBlob(
      (blob) => {
        if (blob) onAccept(blob);
      },
      "image/jpeg",
      0.92,
    );
  };

  // ── Computed display values ───────────────────────────────────────────────────

  const bs = baseScale(natW, natH);
  const dispW = natW * bs * zoom;
  const dispH = natH * bs * zoom;
  const imgLeft = cW / 2 + offset.x - dispW / 2;
  const imgTop = cH / 2 + offset.y - dispH / 2;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl w-full overflow-hidden shadow-2xl"
        style={{ maxWidth: Math.max(cW + 40, 400) }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3E0D9]">
          <h2 className="font-semibold text-[#141414] text-[15px]">
            Crop {label}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg
              text-[#9E9A91] hover:text-[#141414] hover:bg-[#F2EFE8] transition-colors"
            aria-label="Close"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Crop canvas area */}
        <div className="flex flex-col items-center gap-4 p-5 bg-[#141414]">
          {/* Preview frame */}
          <div
            className="relative overflow-hidden cursor-move select-none"
            style={{
              width: cW,
              height: cH,
              borderRadius: mode === "avatar" ? "50%" : "10px",
              outline: "3px solid #D4A843",
              outlineOffset: "2px",
              flexShrink: 0,
            }}
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onWheel={onWheel}
          >
            {/* Dark placeholder while loading */}
            {!imgLoaded && (
              <div className="absolute inset-0 bg-[#1e1e1e] animate-pulse" />
            )}

            {imgSrc && (
              <img
                ref={imgRef}
                src={imgSrc}
                alt="Crop preview"
                draggable={false}
                style={{
                  position: "absolute",
                  width: dispW,
                  height: dispH,
                  left: imgLeft,
                  top: imgTop,
                  userSelect: "none",
                  pointerEvents: "none",
                  opacity: imgLoaded ? 1 : 0,
                  transition: "opacity 0.2s",
                }}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  setNatW(el.naturalWidth);
                  setNatH(el.naturalHeight);
                  setImgLoaded(true);
                  // Re-clamp after we have real dimensions
                  setOffset((prev) =>
                    clamp(
                      prev.x,
                      prev.y,
                      zoom,
                      el.naturalWidth,
                      el.naturalHeight,
                    ),
                  );
                }}
              />
            )}
          </div>

          {/* Zoom slider */}
          <div
            className="flex items-center gap-3 w-full"
            style={{ maxWidth: cW }}
          >
            {/* Minus icon */}
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9E9A91"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35M8 11h6" />
            </svg>
            <input
              type="range"
              min="1"
              max="3"
              step="0.01"
              value={zoom}
              onChange={onZoomChange}
              className="flex-1 accent-[#D4A843]"
              aria-label="Zoom"
            />
            {/* Plus icon */}
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9E9A91"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35M8 11h6M11 8v6" />
            </svg>
          </div>

          <p className="text-[11px] text-white/40 -mt-1">
            Drag to reposition · Scroll or use slider to zoom
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-[#E3E0D9]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-[13.5px] font-medium
              text-[#73706A] hover:bg-[#F2EFE8] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            disabled={!imgLoaded}
            className="px-5 py-2 rounded-xl bg-[#D4A843] text-[#141414]
              text-[13.5px] font-semibold hover:bg-[#C49B35] transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
