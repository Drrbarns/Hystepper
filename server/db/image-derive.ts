/**
 * On-disk derived product images (resized WebP) for fast storefront cards.
 * Originals stay untouched; derivatives live under STORAGE_ROOT/.derived/
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { statObject } from './storage';

const STORAGE_ROOT =
  process.env.STORAGE_ROOT || path.join(process.cwd(), '.storage');

const ALLOWED_WIDTHS = new Set([160, 320, 480, 640, 800, 1080]);

export type DeriveOpts = {
  width: number;
  quality?: number;
};

function clampWidth(w: number): number {
  const n = Math.round(Number(w) || 0);
  if (ALLOWED_WIDTHS.has(n)) return n;
  // Snap to nearest allowed width
  let best = 480;
  let bestDiff = Infinity;
  for (const a of ALLOWED_WIDTHS) {
    const d = Math.abs(a - n);
    if (d < bestDiff) {
      best = a;
      bestDiff = d;
    }
  }
  return best;
}

function derivedPath(bucket: string, objectPath: string, width: number): string {
  const hash = createHash('sha1').update(`${bucket}/${objectPath}`).digest('hex').slice(0, 16);
  const base = path.basename(objectPath).replace(/\.[^.]+$/, '');
  const safeBase = base.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  return path.join(STORAGE_ROOT, '.derived', String(width), bucket, `${safeBase}-${hash}.webp`);
}

export async function getOrCreateDerivedImage(
  bucket: string,
  objectPath: string,
  opts: DeriveOpts
): Promise<{ fullPath: string; contentType: string; size: number } | null> {
  const width = clampWidth(opts.width);
  const quality = Math.min(90, Math.max(40, Math.round(opts.quality ?? 72)));

  const meta = await statObject(bucket, objectPath);
  if (!meta) return null;

  // Don't try to derive from videos
  if (meta.contentType.startsWith('video/')) return null;

  const outPath = derivedPath(bucket, objectPath, width);

  try {
    const st = await fs.stat(outPath);
    if (st.isFile() && st.size > 0 && st.mtimeMs >= (await fs.stat(meta.fullPath)).mtimeMs) {
      return { fullPath: outPath, contentType: 'image/webp', size: st.size };
    }
  } catch {
    /* generate */
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });

  // Atomic write via temp file
  const tmp = `${outPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await sharp(meta.fullPath, { failOn: 'none' })
      .rotate()
      .resize({
        width,
        height: width,
        fit: 'cover',
        position: 'top',
        withoutEnlargement: true,
      })
      .webp({ quality, effort: 4 })
      .toFile(tmp);
    await fs.rename(tmp, outPath);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      /* ignore */
    }
    console.error('[image-derive] failed', bucket, objectPath, err);
    return null;
  }

  const st = await fs.stat(outPath);
  return { fullPath: outPath, contentType: 'image/webp', size: st.size };
}

/** Warm a derivative for a public object path (e.g. products/products/foo.jpeg). */
export async function warmProductThumb(objectPath: string, width = 480): Promise<boolean> {
  const derived = await getOrCreateDerivedImage('products', objectPath, { width });
  return !!derived;
}
