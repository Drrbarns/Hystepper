/**
 * Storefront media URL helpers — prefer host-relative storage paths and
 * request derived WebP thumbs for cards/grids.
 */

const STORAGE_PUBLIC = '/storage/v1/object/public/';

/** Normalize absolute hystepper/storage URLs to host-relative paths. */
export function toStoragePath(src: string | null | undefined): string {
  if (!src || typeof src !== 'string') return '';
  const trimmed = src.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  if (trimmed.startsWith(STORAGE_PUBLIC)) return trimmed;

  try {
    const u = new URL(trimmed, 'https://hystepper.com');
    if (u.pathname.startsWith(STORAGE_PUBLIC)) {
      return `${u.pathname}${u.search}`;
    }
  } catch {
    /* keep as-is */
  }
  return trimmed;
}

export type ThumbOpts = {
  /** Target CSS width hint — snapped server-side to allowed sizes. */
  width?: number;
  quality?: number;
};

/**
 * Card/grid image URL: host-relative storage + ?w= for derived WebP.
 * Full-size originals are used on product detail (pass width undefined / large).
 */
export function productImageSrc(
  src: string | null | undefined,
  opts: ThumbOpts = { width: 480 }
): string {
  const path = toStoragePath(src);
  if (!path || path.startsWith('data:') || path.startsWith('blob:')) return path || '/placeholder-product.png';
  if (!path.includes(STORAGE_PUBLIC)) return path;

  const width = opts.width ?? 480;
  if (!width || width <= 0) return path;

  const q = opts.quality && opts.quality !== 72 ? `&q=${opts.quality}` : '';
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}w=${width}${q}`;
}
