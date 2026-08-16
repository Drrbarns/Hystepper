import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Original maintenance behaviour (restored):
 * - When maintenance_mode is on, storefront redirects to /maintenance
 * - Logged-in admins (admin_session cookie set by /admin) can still preview the site
 * - Admin panel itself is never blocked
 * - On settings-read failure, fail open so a DB blip does not lock the store
 */
let cachedMaintenance: { value: boolean; at: number } | null = null;
const CACHE_TTL_MS = 15_000;

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
    // Fail open — never lock the whole storefront because PostgREST blipped.
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Never gate backend gateway paths or static assets.
  if (
    pathname.startsWith('/rest/') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/storage/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/maintenance' ||
    pathname.startsWith('/favicon') ||
    /\.[^/]+$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/admin')) {
    const response = NextResponse.next();
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    return response;
  }

  const inMaintenance = await isMaintenanceModeEnabled();
  if (inMaintenance) {
    const isAdmin = request.cookies.get('admin_session')?.value === '1';
    if (!isAdmin) {
      return NextResponse.redirect(new URL('/maintenance', request.url));
    }
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
