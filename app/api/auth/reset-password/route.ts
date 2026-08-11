import { NextRequest, NextResponse } from 'next/server';
import {
  findUserByRecoveryToken,
  updateUserPassword,
  userHasVerifiedRecoveryOtp,
} from '@/server/auth';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Complete a forgot-password reset using the one-time email link token
 * AFTER email (+ SMS when phone on file) OTP verification.
 */
export async function POST(req: NextRequest) {
  const clientId = getClientIdentifier(req);
  const rl = checkRateLimit(`auth-reset-password:${clientId}`, {
    maxRequests: 10,
    windowSeconds: 600,
  });
  if (!rl.success) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Please try again later.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const password = String(body.password || '');
  const token = String(body.token || body.access_token || body.token_hash || '').trim();

  if (password.length < 6) {
    return NextResponse.json(
      { success: false, error: 'Password must be at least 6 characters' },
      { status: 400 },
    );
  }
  if (!token || token.length < 16) {
    return NextResponse.json(
      { success: false, error: 'Reset link is missing or invalid. Request a new one.' },
      { status: 400 },
    );
  }

  const row = await findUserByRecoveryToken(token);
  if (!row) {
    return NextResponse.json(
      {
        success: false,
        error: 'Reset link is invalid or expired. Request a new password reset email.',
      },
      { status: 401 },
    );
  }

  if (!userHasVerifiedRecoveryOtp(row)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Verify the codes sent to your email' +
          (row.phone || row.raw_user_meta_data?.phone ? ' and phone' : '') +
          ' before setting a new password.',
        code: 'otp_required',
      },
      { status: 403 },
    );
  }

  await updateUserPassword(row.id, password);

  return NextResponse.json({ success: true });
}
