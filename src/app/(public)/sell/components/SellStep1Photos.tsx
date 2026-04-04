"use client";

import { Alert } from "@/components/ui/primitives";
import type { ImagePreview } from "./sell-types";

interface Props {
  images: ImagePreview[];
  dragActive: boolean;
  errors: Record<string, string>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onClickZone: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onReorder: (from: number, to: number) => void;
}

export default function SellStep1Photos(props: Props) {
  const {
    images,
    dragActive,
    errors,
    fileInputRef,
    onDragEnter,
    onDragLeave,
    onDrop,
    onClickZone,
    onFileChange,
    onRemove,
    onRetry,
    onReorder,
  } = props;
  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="font-[family-name:var(--font-playfair)] text-[1.15rem] font-semibold text-[#141414] mb-1">
          Add photos
        </h2>
        <p className="text-[12.5px] text-[#73706A]">
          Up to 10 photos. First photo is your cover image. Good photos get more
          views.
        </p>
      </div>

      {errors.images && <Alert variant="error">{errors.images}</Alert>}

      {/* Drop zone */}
      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={onClickZone}
        role="button"
        tabIndex={0}
        aria-label="Upload photos"
        onKeyDown={(e) => e.key === "Enter" && onClickZone()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer
          transition-all duration-150 select-none
          ${
            dragActive
              ? "border-[#D4A843] bg-[#F5ECD4]/50"
              : "border-[#C9C5BC] hover:border-[#D4A843] hover:bg-[#F8F7F4]"
          }`}
      >
        <svg
          aria-hidden
          className="mx-auto mb-3 text-[#C9C5BC]"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <p className="text-[13.5px] font-semibold text-[#141414]">
          Click to upload or drag photos here
        </p>
        <p className="text-[12px] text-[#9E9A91] mt-1">
          JPG, PNG, WebP — max 10MB each
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic"
          className="sr-only"
          onChange={onFileChange}
        />
      </div>

      {/* Preview grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5">
          {images.map((img, i) => (
            <div
              key={img.id}
              className="relative group aspect-square rounded-xl overflow-hidden
              border-2 border-[#E3E0D9]"
            >
              <img
                src={img.url}
                alt={`Photo ${i + 1}`}
                className="w-full h-full object-cover"
              />

              {/* Upload progress overlay */}
              {img.uploading && (
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1">
                  <div className="w-3/4 h-1.5 bg-white/30 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#D4A843] rounded-full transition-all duration-300"
                      style={{ width: `${img.progress}%` }}
                    />
                  </div>
                  <span className="text-white text-[10px] font-medium">
                    {img.progress}%
                  </span>
                </div>
              )}

              {/* Processing overlay (compression + WebP conversion) */}
              {img.processing && (
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1">
                  <svg
                    className="animate-spin h-5 w-5 text-[#D4A843]"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  <span className="text-white text-[10px] font-medium">
                    Verifying photo...
                  </span>
                </div>
              )}

              {/* Upload success indicator — green for safe, amber for unverified */}
              {img.uploaded &&
                !img.uploading &&
                !img.processing &&
                !img.error && (
                  <>
                    <div
                      className={`absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center ${
                        img.safe ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                    >
                      {img.safe ? (
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="white"
                          strokeWidth="3"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <span className="text-white text-[9px] font-bold">
                          !
                        </span>
                      )}
                    </div>
                    {!img.safe && (
                      <div className="absolute bottom-1 left-1 right-1 bg-amber-600/90 text-white text-[8px] px-1.5 py-0.5 rounded text-center font-medium">
                        Not verified
                      </div>
                    )}
                    {img.safe && img.compressedSize && (
                      <div
                        className="absolute bottom-1 right-1 bg-black/70 text-white
                      text-[8px] px-1.5 py-0.5 rounded-full font-medium"
                      >
                        {(img.compressedSize / 1024).toFixed(0)}KB
                        {img.dimensions &&
                          ` · ${img.dimensions.width}×${img.dimensions.height}`}
                      </div>
                    )}
                  </>
                )}

              {/* Upload error */}
              {img.error && (
                <div className="absolute inset-0 bg-red-500/20 flex flex-col items-center justify-center gap-1 p-1">
                  <span className="text-red-700 text-[9px] font-semibold bg-white/90 px-1.5 py-0.5 rounded text-center leading-tight max-w-full truncate">
                    {img.error}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry(img.id);
                    }}
                    className="text-[9px] text-white bg-red-600 px-2 py-0.5 rounded-full font-medium
                      hover:bg-red-700 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}

              {i === 0 && !img.uploading && !img.error && (
                <div
                  className="absolute bottom-1 left-1 bg-[#D4A843] text-[#141414]
                  text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                >
                  COVER
                </div>
              )}

              {/* Remove */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(img.id);
                }}
                aria-label={`Remove photo ${i + 1}`}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60
                  text-white flex items-center justify-center opacity-0
                  group-hover:opacity-100 transition-opacity text-[10px]"
              >
                ×
              </button>

              {/* Move left */}
              {i > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onReorder(i, i - 1);
                  }}
                  aria-label="Move photo left"
                  className="absolute left-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full
                    bg-black/60 text-white flex items-center justify-center
                    opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
              )}
            </div>
          ))}

          {/* Add more */}
          {images.length < 10 && (
            <button
              onClick={onClickZone}
              className="aspect-square rounded-xl border-2 border-dashed border-[#C9C5BC]
                flex items-center justify-center text-[#9E9A91]
                hover:border-[#D4A843] hover:text-[#D4A843] transition-colors"
              aria-label="Add more photos"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
