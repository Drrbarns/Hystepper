import { NextResponse } from 'next/server';
import { verifyAccessToken } from '@/server/auth';
import { query } from '@/server/db/pool';

export type StaffAuthResult = {
  userId: string;
  isSuperAdmin: boolean;
  staffRole: string | null;
  permissions: Record<string, boolean>;
};

function extractAccessToken(request: Request): string | null {
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  if (bearer) return bearer;

  const cookieHeader = request.headers.get('cookie') || '';
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)sb-[^=]+-auth-token=([^;]+)/);
  if (!cookieMatch) return null;

  try {
    const raw = decodeURIComponent(cookieMatch[1]);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed[0]?.access_token) {
      return String(parsed[0].access_token);
    }
    if (parsed?.access_token) {
      return String(parsed.access_token);
    }
  } catch {
    /* ignore malformed cookie */
  }

  return null;
}

/**
 * Require an authenticated super-admin (profiles.role = admin) or active staff row.
 * Returns staff context or a 401/403 NextResponse.
 */
export async function requireStaff(
  request: Request,
  opts?: { permission?: string; superAdminOnly?: boolean }
): Promise<StaffAuthResult | NextResponse> {
  const token = extractAccessToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const verified = await verifyAccessToken(token);
  if (!verified?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = verified.sub;

  const { rows: profileRows } = await query<{ role: string }>(
    `SELECT role::text AS role FROM public.profiles WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const profileRole = profileRows[0]?.role || null;
  const isSuperAdmin = profileRole === 'admin';

  if (opts?.superAdminOnly) {
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden — super-admin required' }, { status: 403 });
    }
    return {
      userId,
      isSuperAdmin: true,
      staffRole: 'admin',
      permissions: {},
    };
  }

  if (isSuperAdmin) {
    return {
      userId,
      isSuperAdmin: true,
      staffRole: 'admin',
      permissions: {},
    };
  }

  const { rows: staffRows } = await query<{
    role: string;
    permissions: Record<string, boolean> | null;
  }>(
    `SELECT role::text AS role, permissions
     FROM public.staff
     WHERE user_id = $1 AND is_active IS TRUE
     LIMIT 1`,
    [userId]
  );

  const staffRow = staffRows[0];
  if (!staffRow) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const permissions = (staffRow.permissions || {}) as Record<string, boolean>;

  if (opts?.permission && !permissions[opts.permission]) {
    return NextResponse.json(
      { error: `Forbidden — missing permission: ${opts.permission}` },
      { status: 403 }
    );
  }

  return {
    userId,
    isSuperAdmin: false,
    staffRole: staffRow.role,
    permissions,
  };
}

/** True when token belongs to super-admin or any active staff (not customers). */
export async function isStaffRequest(request: Request): Promise<StaffAuthResult | null> {
  const result = await requireStaff(request);
  if (result instanceof NextResponse) return null;
  return result;
}
