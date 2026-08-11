import { NextRequest, NextResponse } from 'next/server';
import { issueRecoveryOtps } from '@/server/auth';
import { recoveryOtpEmailHtml, sendAuthEmail } from '@/server/auth-email';
import { sendSMS } from '@/lib/notifications';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * After the email reset link is opened, send second-factor OTPs:
 * always email; SMS too when the account has a phone number.
 */
export async function POST(req: NextRequest) {
  const clientId = getClientIdentifier(req);
  const rl = checkRateLimit(`auth-recovery-send-otp:${clientId}`, {
    maxRequests: 8,
    windowSeconds: 600,
  });
  if (!rl.success) {
    return NextResponse.json(
      { success: false, error: 'Too many requests. Please try again later.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const token = String(body.token || body.access_token || body.token_hash || '').trim();
  if (!token || token.length < 16) {
    return NextResponse.json(
      { success: false, error: 'Reset link is missing or invalid. Request a new one.' },
      { status: 400 },
    );
  }

  const issued = await issueRecoveryOtps(token);
  if (!issued) {
    return NextResponse.json(
      {
        success: false,
        error: 'Reset link is invalid or expired. Request a new password reset email.',
      },
      { status: 401 },
    );
  }

  if ('cooldown' in issued && issued.cooldown) {
    return NextResponse.json({
      success: true,
      cooldown: true,
      channels: issued.channels,
      emailHint: issued.emailHint,
      phoneHint: issued.phoneHint,
      message: 'Codes were just sent. Wait a minute before requesting new ones.',
    });
  }

  const payload = issued as Exclude<typeof issued, { cooldown: true }>;

  const emailOk = await sendAuthEmail({
    to: payload.email,
    subject: 'Your Hy_stepper password reset code',
    html: recoveryOtpEmailHtml(payload.emailOtp),
  });

  if (payload.phone && payload.smsOtp) {
    const sms = await sendSMS({
      to: payload.phone,
      message: `Your Hy-Stepper password reset code is ${payload.smsOtp}. It expires in 10 minutes. Do not share this code.`,
    });
    if (!sms?.success) {
      console.error('[recovery-send-otp] SMS OTP failed to send for', payload.phoneHint, sms);
    }
  }

  if (!emailOk) {
    console.error('[recovery-send-otp] email OTP failed to send for', payload.emailHint);
  }

  return NextResponse.json({
    success: true,
    channels: payload.channels,
    emailHint: payload.emailHint,
    phoneHint: payload.phoneHint,
    message: payload.channels.includes('sms')
      ? 'We sent a code to your email and phone.'
      : 'We sent a code to your email.',
  });
}
