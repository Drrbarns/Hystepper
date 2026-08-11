import { NextRequest, NextResponse } from 'next/server';
import { issueRecoveryOtps } from '@/server/auth';
import { recoveryOtpEmailHtml, sendAuthEmail } from '@/server/auth-email';
import { sendSMS } from '@/lib/notifications';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * After the email reset link is opened, send a verification OTP.
 * Email is primary; SMS is only sent when the client requests channel=sms
 * as a backup (account must have a phone on file).
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
  const channelRaw = String(body.channel || 'email').trim().toLowerCase();
  const channel = channelRaw === 'sms' ? 'sms' : 'email';

  if (!token || token.length < 16) {
    return NextResponse.json(
      { success: false, error: 'Reset link is missing or invalid. Request a new one.' },
      { status: 400 },
    );
  }

  const issued = await issueRecoveryOtps(token, { channel });
  if (!issued) {
    return NextResponse.json(
      {
        success: false,
        error: 'Reset link is invalid or expired. Request a new password reset email.',
      },
      { status: 401 },
    );
  }

  if ('error' in issued) {
    return NextResponse.json({ success: false, error: issued.error }, { status: 400 });
  }

  if ('cooldown' in issued && issued.cooldown) {
    return NextResponse.json({
      success: true,
      cooldown: true,
      channel: issued.channel,
      smsAvailable: issued.smsAvailable,
      emailHint: issued.emailHint,
      phoneHint: issued.phoneHint,
      message:
        issued.channel === 'sms'
          ? 'An SMS code was just sent. Wait a minute before requesting another.'
          : 'An email code was just sent. Wait a minute before requesting another.',
    });
  }

  const payload = issued as Exclude<typeof issued, { cooldown: true } | { error: string }>;

  if (payload.channel === 'email' && payload.emailOtp) {
    const emailOk = await sendAuthEmail({
      to: payload.email,
      subject: 'Your Hy_stepper password reset code',
      html: recoveryOtpEmailHtml(payload.emailOtp),
    });
    if (!emailOk) {
      console.error('[recovery-send-otp] email OTP failed to send for', payload.emailHint);
      return NextResponse.json(
        {
          success: false,
          channel: 'email',
          smsAvailable: payload.smsAvailable,
          emailHint: payload.emailHint,
          phoneHint: payload.phoneHint,
          error: payload.smsAvailable
            ? 'Could not send the email code. Try SMS backup instead.'
            : 'Could not send the email code. Please try again in a moment.',
        },
        { status: 502 },
      );
    }
  }

  if (payload.channel === 'sms' && payload.phone && payload.smsOtp) {
    const sms = await sendSMS({
      to: payload.phone,
      message: `Your Hy-Stepper password reset code is ${payload.smsOtp}. It expires in 10 minutes. Do not share this code.`,
    });
    if (!sms?.success) {
      console.error('[recovery-send-otp] SMS OTP failed to send for', payload.phoneHint, sms);
      return NextResponse.json(
        {
          success: false,
          channel: 'sms',
          smsAvailable: payload.smsAvailable,
          emailHint: payload.emailHint,
          phoneHint: payload.phoneHint,
          error: 'Could not send the SMS code. Try the email code instead.',
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    success: true,
    channel: payload.channel,
    smsAvailable: payload.smsAvailable,
    emailHint: payload.emailHint,
    phoneHint: payload.phoneHint,
    message:
      payload.channel === 'sms'
        ? `We sent a code by SMS${payload.phoneHint ? ` (${payload.phoneHint})` : ''}.`
        : `We sent a code to your email${payload.emailHint ? ` (${payload.emailHint})` : ''}.`,
  });
}
