import { NextRequest, NextResponse } from "next/server";
import {
  confirmUserEmail,
  createUser,
  emailConfirmRequired,
  findUserByConfirmationToken,
  findUserByEmail,
  findUserById,
  findUserByRecoveryToken,
  findUserBySmsOtp,
  mintAccessToken,
  normalizeGhanaPhone,
  rowToUser,
  sessionPayload,
  setRecoveryToken,
  setSmsConfirmationOtp,
  touchSignIn,
  updateUserMetadata,
  updateUserPassword,
  verifyAccessToken,
  verifyPassword,
} from "@/server/auth";
import { sendAuthEmail } from "@/server/auth-email";
import { sendSMS } from "@/lib/notifications";
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, x-supabase-api-version");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  return res;
}

function json(data: any, status = 200) {
  return cors(NextResponse.json(data, { status }));
}

function err(message: string, status = 400, code = "invalid_request") {
  return json({ error: code, error_description: message, msg: message, message }, status);
}

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function sendSignupSmsOtp(email: string, opts?: { force?: boolean }) {
  const issued = await setSmsConfirmationOtp(email, opts);
  if (!issued) return { ok: false as const, reason: "unavailable" as const };
  if ("cooldown" in issued && issued.cooldown) {
    return { ok: false as const, reason: "cooldown" as const };
  }
  if (!("otp" in issued)) return { ok: false as const, reason: "unavailable" as const };
  const result = await sendSMS({
    to: issued.phone,
    message: `Your Hy-Stepper verification code is ${issued.otp}. It expires in 10 minutes. Do not share this code.`,
  });
  if (!result?.success) {
    console.error("[Auth SMS] Failed to send OTP:", result);
    return { ok: false as const, reason: "send_failed" as const };
  }
  return { ok: true as const };
}

async function handleToken(req: NextRequest) {
  const url = new URL(req.url);
  const grant = url.searchParams.get("grant_type") || "";
  let body: any = {};
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    body = await req.json().catch(() => ({}));
  } else {
    const text = await req.text();
    body = Object.fromEntries(new URLSearchParams(text));
  }

  if (grant === "password" || body.grant_type === "password" || (body.email && body.password)) {
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const row = await findUserByEmail(email);
    if (!row || !(await verifyPassword(row, password))) {
      return err("Invalid login credentials", 400, "invalid_grant");
    }
    if (!row.email_confirmed_at && emailConfirmRequired()) {
      return err(
        "Please verify your phone before signing in. Enter the SMS code we sent, or request a new code.",
        400,
        "email_not_confirmed"
      );
    }
    const user = rowToUser(row);
    await touchSignIn(user.id);
    const access = await mintAccessToken(user);
    return json(await sessionPayload(user, access));
  }

  if (grant === "refresh_token" || body.grant_type === "refresh_token") {
    const token = String(body.refresh_token || bearer(req) || "");
    const verified = await verifyAccessToken(token);
    if (!verified?.sub) {
      return err("Invalid refresh token", 401, "invalid_grant");
    }
    const row = await findUserById(verified.sub);
    if (!row) return err("User not found", 401, "invalid_grant");
    const user = rowToUser(row);
    const access = await mintAccessToken(user);
    return json(await sessionPayload(user, access));
  }

  return err(`Unsupported grant_type: ${grant || body.grant_type}`, 400);
}

async function handleSignup(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const meta = body.data || body.user_metadata || {};
  const phoneRaw = String(meta.phone || body.phone || "").trim();
  if (!email || !password) return err("Email and password required");

  const requireConfirm = emailConfirmRequired();
  const phone = normalizeGhanaPhone(phoneRaw);
  if (requireConfirm) {
    if (!phoneRaw) return err("Phone number is required to create an account", 400, "phone_required");
    if (!phone) {
      return err(
        "Enter a valid Ghanaian phone number (e.g. 0241234567)",
        400,
        "invalid_phone"
      );
    }
  }

  const existing = await findUserByEmail(email);
  if (existing) return err("User already registered", 400, "user_already_exists");

  const user = await createUser({
    email,
    password,
    phone,
    user_metadata: { ...meta, phone: phone || phoneRaw || null },
    email_confirm: !requireConfirm,
  });

  if (requireConfirm) {
    try {
      const sms = await sendSignupSmsOtp(user.email, { force: true });
      if (!sms.ok) {
        console.error("[Auth] Signup created but SMS OTP failed:", sms.reason);
      }
    } catch (e: any) {
      console.error("[Auth] Signup SMS error:", e?.message || e);
    }
    // GoTrue-compatible: return the user but no session until they verify SMS OTP.
    return json({
      id: user.id,
      aud: user.aud,
      role: user.role,
      email: user.email,
      email_confirmed_at: null,
      phone: user.phone || phone,
      confirmed_at: null,
      last_sign_in_at: null,
      app_metadata: user.app_metadata,
      user_metadata: user.user_metadata,
      identities: [],
      created_at: user.created_at,
      updated_at: user.updated_at,
      is_anonymous: false,
    });
  }

  const access = await mintAccessToken(user);
  return json(await sessionPayload(user, access));
}

async function handleUser(req: NextRequest) {
  const token = bearer(req);
  if (!token) return err("No authorization header", 401, "no_authorization");
  const verified = await verifyAccessToken(token);
  if (!verified?.sub) return err("Invalid token", 401, "invalid_token");
  const row = await findUserById(verified.sub);
  if (!row) return err("User not found", 401, "user_not_found");

  if (req.method === "GET") {
    return json(rowToUser(row));
  }

  if (req.method === "PUT" || req.method === "PATCH") {
    const body = await req.json().catch(() => ({}));
    if (body.password) {
      const newPassword = String(body.password);
      if (newPassword.length < 6) {
        return err("Password must be at least 6 characters", 422, "weak_password");
      }
      // Sessions minted from a recovery link (amr method 'recovery') may set a
      // new password directly — that's the whole point of the reset flow.
      // Regular sessions must prove knowledge of the current password.
      const amrMethod = String(
        (verified.payload as any)?.amr?.[0]?.method || "password"
      );
      if (amrMethod !== "recovery") {
        const current = String(body.current_password || "");
        if (!current) {
          return err("Current password is required to set a new password", 400, "reauthentication_needed");
        }
        if (!(await verifyPassword(row, current))) {
          return err("Current password is incorrect", 400, "invalid_credentials");
        }
      }
      await updateUserPassword(row.id, newPassword);
    }
    if (body.data || body.user_metadata) {
      await updateUserMetadata(row.id, body.data || body.user_metadata || {});
    }
    const updated = await findUserById(row.id);
    return json(rowToUser(updated));
  }

  return err("Method not allowed", 405);
}

async function handleRecover(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim();
  // Always return success to avoid email enumeration
  const token = email ? await setRecoveryToken(email) : null;
  if (token && process.env.RESEND_API_KEY) {
    try {
      const base = process.env.NEXT_PUBLIC_APP_URL || "https://hystepper.com";
      const link = `${base}/auth/reset-password#access_token=${token}&type=recovery`;
      await sendAuthEmail({
        to: email,
        subject: "Reset your Hy_stepper password",
        html: `<p>Reset your password:</p><p><a href="${link}">${link}</a></p>`,
      });
    } catch {
      /* ignore */
    }
  }
  return json({ message: "If that email exists, a recovery link was sent" });
}

async function handleVerify(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || body.token_hash || "");
  const type = String(body.type || "");
  const email = String(body.email || "").trim().toLowerCase();
  const clientId = getClientIdentifier(req);

  // SMS OTP verification (primary signup path)
  if ((type === "sms" || type === "signup") && token && email) {
    const rl = checkRateLimit(
      `auth-otp-verify:${clientId}:${email}`,
      RATE_LIMITS.authOtpVerify
    );
    if (!rl.success) {
      return err("Too many verification attempts. Please try again later.", 429, "over_request_rate_limit");
    }

    // Prefer SMS OTP when email is supplied (UI flow). Fall through to token-hash for email links.
    const smsRow = await findUserBySmsOtp(email, token);
    if (smsRow) {
      const user = await confirmUserEmail(smsRow.id);
      if (!user) return err("Could not verify account", 400);
      const access = await mintAccessToken(user);
      await touchSignIn(user.id);
      return json(await sessionPayload(user, access));
    }
    if (type === "sms" || /^\d{6}$/.test(token.replace(/\D/g, ""))) {
      return err("Invalid or expired verification code", 401, "otp_expired");
    }
  }

  if ((type === "signup" || type === "email") && token) {
    const row = await findUserByConfirmationToken(token);
    if (!row) return err("Invalid or expired confirmation link", 401, "otp_expired");
    const user = await confirmUserEmail(row.id);
    if (!user) return err("Could not confirm email", 400);
    const access = await mintAccessToken(user);
    await touchSignIn(user.id);
    return json(await sessionPayload(user, access));
  }

  if (type === "recovery" && token) {
    const row = await findUserByRecoveryToken(token);
    if (!row) return err("Invalid or expired recovery link", 401, "otp_expired");
    const user = rowToUser(row);
    // Short-lived session flagged as 'recovery' so /auth/v1/user allows the
    // password change without asking for the (forgotten) current password.
    const access = await mintAccessToken(user, "1h", "recovery");
    return json(await sessionPayload(user, access));
  }
  return err("Unsupported verify request");
}

/** Resend signup SMS OTP. Always returns the same success shape to avoid enumeration. */
async function handleResend(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const type = String(body.type || "signup");
  const generic = { message: "If that account needs verification, a new SMS code was sent" };

  if (email && (type === "signup" || type === "sms")) {
    const clientId = getClientIdentifier(req);
    const rl = checkRateLimit(`auth-otp-resend:${clientId}:${email}`, RATE_LIMITS.authOtpResend);
    if (!rl.success) return json(generic);

    const row = await findUserByEmail(email);
    if (row && !row.email_confirmed_at) {
      try {
        await sendSignupSmsOtp(email);
      } catch (e: any) {
        console.error("[Auth] Resend SMS error:", e?.message || e);
      }
    }
  }
  return json(generic);
}

async function handleLogout() {
  return json({});
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  const p = path.join("/");
  if (p === "user") return handleUser(req);
  if (p === "health") return json({ version: "hystepper-auth", name: "GoTrue" });

  // Email-click style: /auth/v1/verify?token=...&type=signup&redirect_to=...
  if (p === "verify") {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") || url.searchParams.get("token_hash") || "";
    const type = url.searchParams.get("type") || "signup";
    const redirectTo =
      url.searchParams.get("redirect_to") ||
      `${process.env.NEXT_PUBLIC_APP_URL || "https://hystepper.com"}/auth/login?confirmed=1`;

    if ((type === "signup" || type === "email") && token) {
      const row = await findUserByConfirmationToken(token);
      if (row) {
        await confirmUserEmail(row.id);
        return NextResponse.redirect(redirectTo);
      }
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL || "https://hystepper.com"}/auth/login?error=invalid_confirmation`
      );
    }
  }

  return err(`Not found: ${p}`, 404);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  const p = path.join("/");
  if (p === "token" || path[0] === "token") return handleToken(req);
  if (p === "signup") return handleSignup(req);
  if (p === "recover") return handleRecover(req);
  if (p === "verify") return handleVerify(req);
  if (p === "resend") return handleResend(req);
  if (p === "logout") return handleLogout();
  return err(`Not found: ${p}`, 404);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  if (path.join("/") === "user") return handleUser(req);
  return err("Not found", 404);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  if (path.join("/") === "user") return handleUser(req);
  return err("Not found", 404);
}
