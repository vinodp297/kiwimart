// src/server/lib/fileValidation.ts
// ─── Upload Security — Magic Byte + Extension + Size Validation ───────────────
// Validates file uploads server-side to prevent MIME-type spoofing, SVG XSS,
// and dangerous file types before they reach R2 storage.
//
// Magic byte validation: reads first bytes of the buffer to confirm the file
// really is the declared type — a PNG renamed as .jpg can't fool this check.
//
// Apply to any route that receives a Buffer from the client (e.g. disputes.ts).
// Presigned upload routes (images.ts, profile-images.ts) bypass the server, so
// validation must be applied at read time instead.

// ── Magic byte signatures for allowed types ───────────────────────────────────
// Key = MIME type, Value = expected leading bytes

const MAGIC_BYTES: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png':  [0x89, 0x50, 0x4e, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46],  // 'RIFF' — WebP container
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_SIZE_BYTES = 8 * 1024 * 1024  // 8 MB

// Extensions that must never be accepted regardless of MIME type
const DANGEROUS_EXTENSION_RE =
  /\.(php\d?|phtml|phar|asp|aspx|jsp|py|rb|sh|bash|exe|bat|cmd|ps1|svg|svgz|xml|html?|xhtml)$/i

// ── Exported helpers ──────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * Returns true if the buffer's first bytes match the expected magic
 * bytes for the given MIME type.
 */
export function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const expected = MAGIC_BYTES[mimeType]
  if (!expected) return false
  if (buffer.length < expected.length) return false
  return expected.every((byte, i) => buffer[i] === byte)
}

/**
 * Full file validation — call before uploading to R2.
 *
 * Checks (in order):
 *   1. SVG blocked entirely (XSS via embedded scripts)
 *   2. Dangerous extension blocked
 *   3. MIME type whitelist (JPEG / PNG / WebP only)
 *   4. File size ≤ 8 MB
 *   5. Magic bytes match declared MIME type (prevents MIME spoofing)
 */
export function validateImageFile({
  buffer,
  mimetype,
  size,
  originalname,
}: {
  buffer: Buffer
  mimetype: string
  size: number
  originalname: string
}): ValidationResult {
  // Block SVG entirely — can embed <script> tags, causing stored XSS
  if (
    mimetype === 'image/svg+xml' ||
    mimetype === 'image/svg' ||
    /\.svgz?$/i.test(originalname)
  ) {
    return { valid: false, error: 'SVG files are not allowed for security reasons.' }
  }

  // Block dangerous extensions regardless of MIME type
  if (DANGEROUS_EXTENSION_RE.test(originalname)) {
    return { valid: false, error: 'File type not allowed.' }
  }

  // MIME type whitelist
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    return { valid: false, error: 'Only JPEG, PNG, and WebP images are allowed.' }
  }

  // Size limit
  if (size > MAX_SIZE_BYTES) {
    return { valid: false, error: 'File size must be under 8 MB.' }
  }

  // Magic bytes — confirm file contents match declared type
  if (!validateMagicBytes(buffer, mimetype)) {
    return {
      valid: false,
      error: 'File contents do not match the declared image type. Please upload a valid image.',
    }
  }

  return { valid: true }
}
