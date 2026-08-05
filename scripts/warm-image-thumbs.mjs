#!/usr/bin/env node
/**
 * Pre-generate WebP card thumbs by hitting the public storage ?w= endpoint.
 * Usage (after deploy):
 *   node scripts/warm-image-thumbs.mjs --base https://hystepper.com
 */

const BASE = (process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : process.env.NEXT_PUBLIC_APP_URL || 'https://hystepper.com'
).replace(/\/+$/, '');

const WIDTHS = [160, 480, 1080];
const CONCURRENCY = 4;

async function main() {
  const rest = `${BASE}/rest/v1/product_images?select=url&limit=2000`;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  const res = await fetch(rest, {
    headers: key
      ? { apikey: key, Authorization: `Bearer ${key}` }
      : {},
  });
  if (!res.ok) {
    console.error('Failed to list images', res.status, await res.text());
    process.exit(1);
  }
  const rows = await res.json();
  const urls = [...new Set(
    (rows || [])
      .map((r) => r.url)
      .filter((u) => typeof u === 'string' && u.includes('/storage/v1/object/public/products/') && !u.startsWith('data:video'))
  )];

  console.log(`Warming ${urls.length} images × ${WIDTHS.length} sizes against ${BASE}`);

  let i = 0;
  let ok = 0;
  let fail = 0;

  async function one(url) {
    let path = url;
    try {
      const u = new URL(url, BASE);
      path = u.pathname;
    } catch { /* keep */ }
    for (const w of WIDTHS) {
      const target = `${BASE}${path}?w=${w}`;
      const t0 = Date.now();
      try {
        const r = await fetch(target, { headers: { Accept: 'image/webp,*/*' } });
        const buf = await r.arrayBuffer();
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        ok++;
        console.log(`OK ${w} ${(buf.byteLength / 1024).toFixed(1)}KB ${Date.now() - t0}ms ${path}`);
      } catch (e) {
        fail++;
        console.error(`FAIL ${w} ${path}`, e.message || e);
      }
    }
  }

  const queue = [...urls];
  async function worker() {
    while (queue.length) {
      const next = queue.shift();
      if (!next) return;
      i++;
      await one(next);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`Done. ok=${ok} fail=${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
