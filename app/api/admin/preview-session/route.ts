import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/require-staff';

const COOKIE = 'hy_admin_preview';
const MAX_AGE = 60 * 60 * 24; // 24h

function previewCookie(value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly${secure}`;
}

/**
 * After admin login, set an HttpOnly cookie middleware can trust so staff
 * can preview the storefront while maintenance_mode is on.
 * Auth alone lives in localStorage and is invisible to middleware.
 */
export async function POST(request: Request) {
  const staff = await requireStaff(request);
  if (staff instanceof NextResponse) return staff;

  const res = NextResponse.json({ ok: true });
  res.headers.append('Set-Cookie', previewCookie('1', MAX_AGE));
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.append('Set-Cookie', previewCookie('', 0));
  return res;
}
