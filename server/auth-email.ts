/**
 * Branded auth emails (signup confirmation, password reset).
 * Sent via Resend — same path as order notifications.
 */

const BRAND_FROM = () =>
  process.env.AUTH_EMAIL_FROM ||
  process.env.EMAIL_FROM ||
  "Hy_stepper <noreply@hystepper.com>";

const APP_URL = () =>
  (process.env.NEXT_PUBLIC_APP_URL || "https://hystepper.com").replace(/\/+$/, "");

export function confirmationEmailHtml(confirmUrl: string, firstName?: string): string {
  const greeting = firstName ? `Hi ${firstName},` : "Welcome to Hy_stepper!";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#FBF6F2;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBF6F2;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:#111827;padding:28px 40px;text-align:center;">
              <span style="font-size:26px;font-weight:bold;color:#ffffff;letter-spacing:1px;">Hy_stepper</span>
              <p style="margin:6px 0 0;color:#d1d5db;font-size:13px;">Stay Sleek in Style</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:22px;">Confirm your email</h2>
              <p style="margin:0 0 24px;color:#4b5563;font-size:15px;line-height:1.6;">
                ${greeting}<br><br>
                Tap the button below to confirm your email address and activate your account.
              </p>
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${confirmUrl}"
                       style="display:inline-block;background:#A14F57;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 40px;border-radius:999px;">
                      Confirm my email
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:28px 0 0;color:#9ca3af;font-size:12px;line-height:1.6;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${confirmUrl}" style="color:#A14F57;word-break:break-all;">${confirmUrl}</a>
              </p>
              <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;">
                Didn't create an account with us? You can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #f3f4f6;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                © Hy_stepper · Accra, Ghana ·
                <a href="${APP_URL()}" style="color:#A14F57;text-decoration:none;">hystepper.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendAuthEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[auth-email] RESEND_API_KEY not configured — skipping send");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: BRAND_FROM(),
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[auth-email] Resend failed:", res.status, body);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[auth-email] send failed:", err);
    return false;
  }
}

export function buildConfirmUrl(token: string): string {
  return `${APP_URL()}/auth/confirm?token=${encodeURIComponent(token)}&type=signup`;
}

/** 6-digit OTP email for forgot-password second factor. */
export function recoveryOtpEmailHtml(otp: string, firstName?: string): string {
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#FBF6F2;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBF6F2;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:#111827;padding:28px 40px;text-align:center;">
              <span style="font-size:26px;font-weight:bold;color:#ffffff;letter-spacing:1px;">Hy_stepper</span>
              <p style="margin:6px 0 0;color:#d1d5db;font-size:13px;">Stay Sleek in Style</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:22px;">Password reset code</h2>
              <p style="margin:0 0 24px;color:#4b5563;font-size:15px;line-height:1.6;">
                ${greeting}<br><br>
                Use this code to verify your identity before setting a new password. It expires in 10 minutes.
              </p>
              <p style="margin:0 0 8px;text-align:center;font-size:32px;font-weight:bold;letter-spacing:0.35em;color:#111827;">
                ${otp}
              </p>
              <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;line-height:1.6;">
                If you didn&apos;t request a password reset, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #f3f4f6;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                © Hy_stepper · Accra, Ghana ·
                <a href="${APP_URL()}" style="color:#A14F57;text-decoration:none;">hystepper.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
