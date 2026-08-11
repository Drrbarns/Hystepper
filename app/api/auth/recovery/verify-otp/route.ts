import { NextRequest, NextResponse } from 'next/server';
import { verifyRecoveryOtps } from '@/server/auth';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Verify the active recovery OTP (email primary, or SMS backup) before a new password. */
export async function POST(req: NextRequest) {
  const clientId = getClientIdentifier(req);
  const rl = checkRateLimit(`auth-recovery-verify-otp:${clientId}`, {
    maxRequests: 20,
    windowSeconds: 600,
  });
  if (!rl.success) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Please try again later.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const token = String(body.token || body.access_token || body.token_hash || '').trim();
  const otp = String(body.otp || body.email_otp || body.emailOtp || body.sms_otp || body.smsOtp || '').trim();

  if (!token || token.length < 16) {
    return NextResponse.json(
      { success: false, error: 'Reset link is missing or invalid. Request a new one.' },
      { status: 400 },
    );
  }

  const result = await verifyRecoveryOtps(token, { otp });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, verified: true });
}
