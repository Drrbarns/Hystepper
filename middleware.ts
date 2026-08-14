import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

let cachedMaintenance: { value: boolean; at: number } | null = null;
const CACHE_TTL_MS = 15_000;
/** Keep last known value for much longer if PostgREST is briefly unreachable. */
const STALE_OK_MS = 10 * 60_000;

function parseMaintenanceFlag(raw: unknown): boolean {
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0 || raw == null) return false;
  const s = String(raw).trim().replace(/^"+|"+$/g, '').toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

async function isMaintenanceModeEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cachedMaintenance && now - cachedMaintenance.at < CACHE_TTL_MS) {
    return cachedMaintenance.value;
  }
  try {
    const base = (
      process.env.POSTGREST_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      ''
    ).replace(/\/$/, '');
    const finalUrl = base.includes('/rest/v1')
      ? `${base}/store_settings?key=eq.maintenance_mode&select=value&limit=1`
      : base.endsWith(':3000') || base.includes('hystepper-rest')
        ? `${base}/store_settings?key=eq.maintenance_mode&select=value&limit=1`
        : `${base}/rest/v1/store_settings?key=eq.maintenance_mode&select=value&limit=1`;

    const res = await fetch(finalUrl, {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) throw new Error(`maintenance check HTTP ${res.status}`);
    const data: Array<{ value: unknown }> = await res.json();
    const enabled = parseMaintenanceFlag(data?.[0]?.value);
    cachedMaintenance = { value: enabled, at: now };
    return enabled;
  } catch {
    // Do NOT fail open: if we recently knew maintenance was on, keep blocking.
    if (cachedMaintenance && now - cachedMaintenance.at < STALE_OK_MS) {
      return cachedMaintenance.value;
    }
    // Unknown / cold start with DB errors — don't lock the whole store.
    // The forgeable admin_session bypass is removed; that was the real hole.
    return cachedMaintenance?.value ?? false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Never gate backend gateway paths, admin, or static assets.
  // Admin UI stays reachable so staff can turn maintenance off.
  // Storefront preview during maintenance is intentionally blocked for everyone
  // (including anyone with a forgeable client-side admin_session cookie).
  if (
    pathname.startsWith('/rest/') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/storage/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/admin') ||
    pathname === '/maintenance' ||
    pathname.startsWith('/favicon') ||
    /\.[^/]+$/.test(pathname)
  ) {
    if (pathname.startsWith('/admin')) {
      const response = NextResponse.next();
      response.headers.set('X-Robots-Tag', 'noindex, nofollow');
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      return response;
    }
    return NextResponse.next();
  }

  const inMaintenance = await isMaintenanceModeEnabled();
  if (inMaintenance) {
    return NextResponse.redirect(new URL('/maintenance', request.url));
  }

  const response = NextResponse.next();
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
