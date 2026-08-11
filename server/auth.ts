/**
 * GoTrue-compatible JWT helpers for plain-Postgres auth.
 * Tokens are HS256 JWTs PostgREST understands (role + sub claims).
 */
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { randomBytes, randomInt } from "crypto";
import { query } from "./db/pool";

/** Ghana phone → E.164 (+233…). Returns null if invalid. */
export function normalizeGhanaPhone(phone: string): string | null {
  const cleaned = String(phone || "").replace(/\D/g, "");
  let digits = cleaned;
  if (digits.startsWith("0") && digits.length === 10) {
    digits = "233" + digits.slice(1);
  } else if (digits.length === 9) {
    digits = "233" + digits;
  } else if (digits.startsWith("233") && digits.length === 12) {
    // already good
  } else {
    return null;
  }
  // Ghana mobiles: +233 + 9 digits (0XXXXXXXXX locally).
  if (!/^233\d{9}$/.test(digits)) return null;
  return `+${digits}`;
}

const SMS_OTP_PREFIX = "sms:";
const SMS_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SMS_RESEND_COOLDOWN_MS = 60 * 1000;
const SMS_OTP_MAX_ATTEMPTS = 8;

/** Forgot-password second-factor OTPs (stored in raw_app_meta_data.recovery_otp). */
const RECOVERY_OTP_TTL_MS = 10 * 60 * 1000;
const RECOVERY_OTP_VERIFIED_TTL_MS = 15 * 60 * 1000;
const RECOVERY_OTP_RESEND_MS = 60 * 1000;
const RECOVERY_OTP_MAX_ATTEMPTS = 8;

type RecoveryOtpChannel = "email" | "sms";

type RecoveryOtpState = {
  /** Active verification channel — email primary, SMS only as backup. */
  channel: RecoveryOtpChannel;
  email_hash?: string | null;
  sms_hash?: string | null;
  sent_at: string;
  attempts: number;
  verified_at?: string | null;
  /** Legacy fields kept for in-flight sessions from older deploys. */
  require_sms?: boolean;
  email_attempts?: number;
  sms_attempts?: number;
  email_ok?: boolean;
  sms_ok?: boolean;
};

export function maskEmailForHint(email: string): string {
  const e = String(email || "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 1) return "***";
  const user = e.slice(0, at);
  const domain = e.slice(at + 1);
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}***@${domain}`;
}

export function maskPhoneForHint(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

function readRecoveryOtpState(row: any): RecoveryOtpState | null {
  const raw = row?.raw_app_meta_data?.recovery_otp;
  if (!raw || typeof raw !== "object") return null;
  if (!raw.sent_at) return null;

  // Prefer explicit channel; fall back for sessions created before this change.
  let channel: RecoveryOtpChannel =
    raw.channel === "sms" || raw.channel === "email"
      ? raw.channel
      : raw.require_sms && !raw.email_ok
        ? "email" // old dual-code flow still started on email
        : raw.sms_hash && !raw.email_hash
          ? "sms"
          : "email";

  const emailHash = raw.email_hash ? String(raw.email_hash) : null;
  const smsHash = raw.sms_hash ? String(raw.sms_hash) : null;
  if (channel === "email" && !emailHash) return null;
  if (channel === "sms" && !smsHash) return null;

  const attempts =
    Number(raw.attempts ?? 0) ||
    Number(raw.email_attempts || 0) + Number(raw.sms_attempts || 0);

  return {
    channel,
    email_hash: emailHash,
    sms_hash: smsHash,
    sent_at: String(raw.sent_at),
    attempts,
    verified_at: raw.verified_at ? String(raw.verified_at) : null,
    require_sms: !!raw.require_sms,
    email_attempts: Number(raw.email_attempts || 0),
    sms_attempts: Number(raw.sms_attempts || 0),
    email_ok: !!raw.email_ok,
    sms_ok: !!raw.sms_ok,
  };
}

async function writeRecoveryOtpState(userId: string, state: RecoveryOtpState | null) {
  if (!state) {
    await query(
      `UPDATE auth.users
       SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) - 'recovery_otp',
           updated_at = now()
       WHERE id = $1`,
      [userId]
    );
    return;
  }
  await query(
    `UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object('recovery_otp', $1::jsonb),
         updated_at = now()
     WHERE id = $2`,
    [JSON.stringify(state), userId]
  );
}

/** Resolve phone from auth.users / metadata / profiles for recovery SMS. */
export async function resolveUserPhone(row: any): Promise<string | null> {
  const direct =
    normalizeGhanaPhone(row?.phone || "") ||
    normalizeGhanaPhone(row?.raw_user_meta_data?.phone || "");
  if (direct) return direct;
  if (!row?.id) return null;
  const { rows } = await query<{ phone: string | null }>(
    `SELECT phone FROM public.profiles WHERE id = $1 LIMIT 1`,
    [row.id]
  );
  return normalizeGhanaPhone(rows[0]?.phone || "");
}

/**
 * Issue a recovery OTP for an active reset link.
 * Email is primary; SMS is opt-in backup when the user didn't get email.
 */
export async function issueRecoveryOtps(
  recoveryToken: string,
  opts?: { force?: boolean; channel?: RecoveryOtpChannel }
): Promise<
  | {
      channel: RecoveryOtpChannel;
      smsAvailable: boolean;
      emailHint: string;
      phoneHint: string | null;
      cooldown?: false;
      emailOtp: string | null;
      smsOtp: string | null;
      userId: string;
      email: string;
      phone: string | null;
    }
  | {
      cooldown: true;
      channel: RecoveryOtpChannel;
      smsAvailable: boolean;
      emailHint: string;
      phoneHint: string | null;
    }
  | { error: string }
  | null
> {
  const row = await findUserByRecoveryToken(recoveryToken);
  if (!row) return null;

  const phone = await resolveUserPhone(row);
  const smsAvailable = !!phone;
  const requested = opts?.channel === "sms" ? "sms" : "email";
  if (requested === "sms" && !phone) {
    return { error: "No phone number on this account. Use the email code instead." };
  }

  const existing = readRecoveryOtpState(row);
  if (!opts?.force && existing?.sent_at && existing.channel === requested) {
    const elapsed = Date.now() - new Date(existing.sent_at).getTime();
    if (elapsed < RECOVERY_OTP_RESEND_MS && elapsed >= 0) {
      return {
        cooldown: true,
        channel: requested,
        smsAvailable,
        emailHint: maskEmailForHint(row.email),
        phoneHint: phone ? maskPhoneForHint(phone) : null,
      };
    }
  }

  const emailOtp = requested === "email" ? generateSmsOtp() : null;
  const smsOtp = requested === "sms" ? generateSmsOtp() : null;
  const state: RecoveryOtpState = {
    channel: requested,
    email_hash: emailOtp ? bcrypt.hashSync(emailOtp, 8) : null,
    sms_hash: smsOtp ? bcrypt.hashSync(smsOtp, 8) : null,
    sent_at: new Date().toISOString(),
    attempts: 0,
    verified_at: null,
    require_sms: false,
    email_attempts: 0,
    sms_attempts: 0,
    email_ok: false,
    sms_ok: false,
  };
  await writeRecoveryOtpState(row.id, state);

  return {
    channel: requested,
    smsAvailable,
    emailHint: maskEmailForHint(row.email),
    phoneHint: phone ? maskPhoneForHint(phone) : null,
    emailOtp,
    smsOtp,
    userId: row.id,
    email: row.email,
    phone,
  };
}

/**
 * Verify the active recovery OTP (email primary, or SMS if user switched to backup).
 * On success sets recovery_otp.verified_at (short window for password write).
 */
export async function verifyRecoveryOtps(
  recoveryToken: string,
  opts: { otp?: string; emailOtp?: string; smsOtp?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await findUserByRecoveryToken(recoveryToken);
  if (!row) return { ok: false, error: "Reset link is invalid or expired. Request a new one." };

  const state = readRecoveryOtpState(row);
  if (!state) return { ok: false, error: "Request a verification code first." };

  const age = Date.now() - new Date(state.sent_at).getTime();
  if (Number.isNaN(age) || age > RECOVERY_OTP_TTL_MS) {
    return { ok: false, error: "Verification code expired. Tap Resend for a new code." };
  }

  if (state.attempts >= RECOVERY_OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "Too many attempts. Request a new code." };
  }

  const channel = state.channel;
  const rawOtp =
    String(opts.otp || "").replace(/\D/g, "") ||
    (channel === "sms"
      ? String(opts.smsOtp || opts.emailOtp || "").replace(/\D/g, "")
      : String(opts.emailOtp || opts.smsOtp || "").replace(/\D/g, ""));

  if (!/^\d{6}$/.test(rawOtp)) {
    return {
      ok: false,
      error: channel === "sms"
        ? "Enter the 6-digit SMS code."
        : "Enter the 6-digit email code.",
    };
  }

  // Legacy dual-code sessions stored both hashes + require_sms. New policy:
  // one matching code on the active channel is enough (email preferred).
  const candidates = [
    channel === "sms" ? state.sms_hash : state.email_hash,
    // Allow email code even if an old session still marked require_sms.
    state.email_hash,
  ].filter(Boolean) as string[];

  const matched = candidates.some((hash) => bcrypt.compareSync(rawOtp, hash));
  if (!matched) {
    const next: RecoveryOtpState = { ...state, attempts: state.attempts + 1 };
    await writeRecoveryOtpState(row.id, next);
    return {
      ok: false,
      error: channel === "sms"
        ? "Invalid SMS verification code."
        : "Invalid email verification code.",
    };
  }

  const verified: RecoveryOtpState = {
    ...state,
    email_ok: true,
    sms_ok: channel === "sms",
    require_sms: false,
    verified_at: new Date().toISOString(),
  };
  await writeRecoveryOtpState(row.id, verified);
  return { ok: true };
}

/** True when recovery OTPs were verified recently (password may be set). */
export function userHasVerifiedRecoveryOtp(row: any): boolean {
  const state = readRecoveryOtpState(row);
  if (!state?.verified_at) return false;
  const at = new Date(state.verified_at).getTime();
  if (Number.isNaN(at)) return false;
  return Date.now() - at < RECOVERY_OTP_VERIFIED_TTL_MS;
}

export function generateSmsOtp(): string {
  return String(randomInt(100000, 1000000));
}

/** Store hashed OTP as `sms:<bcrypt>` so DB leaks don't expose the code. */
export function smsOtpToken(otp: string): string {
  return `${SMS_OTP_PREFIX}${bcrypt.hashSync(otp, 8)}`;
}

export function isSmsOtpToken(token: string | null | undefined): boolean {
  return !!token && token.startsWith(SMS_OTP_PREFIX);
}

const ISSUER = "hystepper-auth";

function jwtSecret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

export type AppUser = {
  id: string;
  email: string;
  role: string;
  aud: string;
  user_metadata: Record<string, any>;
  app_metadata: Record<string, any>;
  email_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  phone?: string | null;
};

function rowToUser(row: any): AppUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role || "authenticated",
    aud: row.aud || "authenticated",
    user_metadata: row.raw_user_meta_data || {},
    app_metadata: row.raw_app_meta_data || {},
    email_confirmed_at: row.email_confirmed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    phone: row.phone,
  };
}

export async function mintAccessToken(
  user: AppUser,
  expiresIn = "7d",
  amrMethod: "password" | "recovery" | "otp" = "password"
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    role: "authenticated",
    email: user.email,
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
    amr: [{ method: amrMethod, timestamp: now }],
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setAudience("authenticated")
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(expiresIn)
    .sign(jwtSecret());
}

export async function mintRefreshToken(user: AppUser): Promise<string> {
  return new SignJWT({ role: "authenticated", typ: "refresh" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setAudience("authenticated")
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(jwtSecret());
}

/** Long-lived keys that mirror Supabase anon / service_role API keys. */
export async function mintApiKey(role: "anon" | "service_role"): Promise<string> {
  return new SignJWT({ role, iss: ISSUER })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience(role === "anon" ? "authenticated" : "service_role")
    .setIssuedAt()
    .setExpirationTime("10y")
    .sign(jwtSecret());
}

export async function verifyAccessToken(token: string): Promise<{ sub: string; role: string; payload: any } | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { issuer: ISSUER });
    return {
      sub: String(payload.sub || ""),
      role: String((payload as any).role || "authenticated"),
      payload,
    };
  } catch {
    return null;
  }
}

export async function findUserByEmail(email: string) {
  const { rows } = await query<any>(
    `SELECT * FROM auth.users WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1`,
    [email.trim()]
  );
  return rows[0] || null;
}

export async function findUserById(id: string) {
  const { rows } = await query<any>(
    `SELECT * FROM auth.users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

export async function verifyPassword(row: any, password: string): Promise<boolean> {
  if (!row?.encrypted_password) return false;
  return bcrypt.compareSync(password, row.encrypted_password);
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export async function createUser(opts: {
  email: string;
  password: string;
  phone?: string | null;
  user_metadata?: Record<string, any>;
  email_confirm?: boolean;
}): Promise<AppUser> {
  const id = crypto.randomUUID();
  const hash = hashPassword(opts.password);
  const meta = opts.user_metadata || {};
  const phone =
    normalizeGhanaPhone(opts.phone || meta.phone || "") ||
    (opts.phone || meta.phone || null);
  const autoConfirm = opts.email_confirm !== false;
  const confirmed = autoConfirm ? new Date().toISOString() : null;
  // Unconfirmed storefront signups get an SMS OTP (set separately after insert).
  const confirmationToken = autoConfirm ? null : null;
  const { rows } = await query<any>(
    `INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, phone,
      email_confirmed_at, phone_confirmed_at, confirmation_token, confirmation_sent_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      $1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, now(), now()
    ) RETURNING *`,
    [
      id,
      opts.email.trim().toLowerCase(),
      hash,
      phone,
      confirmed,
      autoConfirm && phone ? confirmed : null,
      confirmationToken,
      null,
      JSON.stringify({ provider: "email", providers: ["email"] }),
      JSON.stringify({ ...meta, phone: phone || meta.phone || null }),
    ]
  );
  // Ensure profile exists (handle_new_user may or may not fire depending on triggers)
  await query(
    `INSERT INTO public.profiles (id, email, full_name, phone, role, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'customer', now(), now())
     ON CONFLICT (id) DO UPDATE SET
       phone = COALESCE(EXCLUDED.phone, profiles.phone),
       updated_at = now()`,
    [
      id,
      opts.email.trim().toLowerCase(),
      meta.full_name || [meta.first_name, meta.last_name].filter(Boolean).join(" ") || null,
      phone,
    ]
  );
  return rowToUser(rows[0]);
}

export async function getConfirmationToken(userId: string): Promise<string | null> {
  const { rows } = await query<{ confirmation_token: string | null }>(
    `SELECT confirmation_token FROM auth.users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0]?.confirmation_token || null;
}

/** Issue (or rotate) a legacy email-link confirmation token. */
export async function setConfirmationToken(email: string): Promise<string | null> {
  const row = await findUserByEmail(email);
  if (!row || row.email_confirmed_at) return null;
  const token = randomBytes(32).toString("hex");
  await query(
    `UPDATE auth.users
     SET confirmation_token = $1, confirmation_sent_at = now(), updated_at = now()
     WHERE id = $2`,
    [token, row.id]
  );
  return token;
}

/**
 * Issue (or rotate) a 6-digit SMS OTP for an unconfirmed user.
 * Returns { otp, phone, userId } or null if user is missing/already confirmed/no phone.
 * On cooldown, returns { cooldown: true } without rotating the OTP.
 */
export async function setSmsConfirmationOtp(
  email: string,
  opts?: { force?: boolean }
): Promise<
  | { otp: string; phone: string; userId: string; cooldown?: false }
  | { cooldown: true; phone?: string }
  | null
> {
  const row = await findUserByEmail(email);
  if (!row || row.email_confirmed_at) return null;

  const phone = normalizeGhanaPhone(row.phone || row.raw_user_meta_data?.phone || "");
  if (!phone) return null;

  if (!opts?.force && row.confirmation_sent_at) {
    const sentAt = new Date(row.confirmation_sent_at).getTime();
    const elapsed = Date.now() - sentAt;
    if (elapsed < SMS_RESEND_COOLDOWN_MS) {
      return { cooldown: true, phone };
    }
  }

  const otp = generateSmsOtp();
  await query(
    `UPDATE auth.users
     SET confirmation_token = $1,
         confirmation_sent_at = now(),
         phone = COALESCE(phone, $2),
         raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"sms_otp_attempts":0}'::jsonb,
         updated_at = now()
     WHERE id = $3`,
    [smsOtpToken(otp), phone, row.id]
  );
  return { otp, phone, userId: row.id };
}

/** Verify SMS OTP for signup. Returns the user row if valid, else null. */
export async function findUserBySmsOtp(email: string, otp: string) {
  const cleaned = String(otp || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(cleaned)) return null;
  const row = await findUserByEmail(email);
  if (!row || row.email_confirmed_at) return null;
  if (!isSmsOtpToken(row.confirmation_token)) return null;
  if (!row.confirmation_sent_at) return null;
  const age = Date.now() - new Date(row.confirmation_sent_at).getTime();
  if (age > SMS_OTP_TTL_MS) return null;

  const attempts = Number(row.raw_app_meta_data?.sms_otp_attempts || 0);
  if (attempts >= SMS_OTP_MAX_ATTEMPTS) return null;

  const hash = String(row.confirmation_token).slice(SMS_OTP_PREFIX.length);
  const ok = bcrypt.compareSync(cleaned, hash);
  if (!ok) {
    await query(
      `UPDATE auth.users
       SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('sms_otp_attempts', $1::int),
           updated_at = now()
       WHERE id = $2`,
      [attempts + 1, row.id]
    );
    if (attempts + 1 >= SMS_OTP_MAX_ATTEMPTS) {
      await query(
        `UPDATE auth.users
         SET confirmation_token = '', updated_at = now()
         WHERE id = $1`,
        [row.id]
      );
    }
    return null;
  }
  return row;
}

export async function findUserByConfirmationToken(token: string) {
  const { rows } = await query<any>(
    `SELECT * FROM auth.users
     WHERE confirmation_token = $1
       AND deleted_at IS NULL
       AND email_confirmed_at IS NULL
     LIMIT 1`,
    [token]
  );
  return rows[0] || null;
}

export async function confirmUserEmail(userId: string): Promise<AppUser | null> {
  const { rows } = await query<any>(
    `UPDATE auth.users
     SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
         phone_confirmed_at = COALESCE(phone_confirmed_at, now()),
         confirmation_token = '',
         confirmation_sent_at = NULL,
         updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [userId]
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}

export function emailConfirmRequired(): boolean {
  // Default ON for storefront signups (now SMS OTP). Set AUTH_REQUIRE_EMAIL_CONFIRM=false to disable.
  const v = (process.env.AUTH_REQUIRE_EMAIL_CONFIRM ?? "true").toLowerCase();
  return v !== "false" && v !== "0" && v !== "off";
}

export async function updateUserPassword(userId: string, password: string) {
  const hash = hashPassword(password);
  await query(
    `UPDATE auth.users SET encrypted_password = $1, updated_at = now(),
      recovery_token = '', recovery_sent_at = NULL,
      raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) - 'recovery_otp'
     WHERE id = $2`,
    [hash, userId]
  );
}

export async function updateUserMetadata(userId: string, userMeta: Record<string, any>, appMeta?: Record<string, any>) {
  if (appMeta) {
    await query(
      `UPDATE auth.users SET raw_user_meta_data = COALESCE(raw_user_meta_data,'{}'::jsonb) || $1::jsonb,
        raw_app_meta_data = COALESCE(raw_app_meta_data,'{}'::jsonb) || $2::jsonb,
        updated_at = now() WHERE id = $3`,
      [JSON.stringify(userMeta), JSON.stringify(appMeta), userId]
    );
  } else {
    await query(
      `UPDATE auth.users SET raw_user_meta_data = COALESCE(raw_user_meta_data,'{}'::jsonb) || $1::jsonb,
        updated_at = now() WHERE id = $2`,
      [JSON.stringify(userMeta), userId]
    );
  }
  return findUserById(userId);
}

export async function setRecoveryToken(email: string): Promise<string | null> {
  const row = await findUserByEmail(email);
  if (!row) return null;
  const token = randomBytes(32).toString("hex");
  await query(
    `UPDATE auth.users SET recovery_token = $1, recovery_sent_at = now(), updated_at = now() WHERE id = $2`,
    [token, row.id]
  );
  return token;
}

/** Recovery links are valid for 1 hour from the moment the email is sent. */
export async function findUserByRecoveryToken(token: string) {
  if (!token || token.length < 16) return null;
  const { rows } = await query<any>(
    `SELECT * FROM auth.users
     WHERE recovery_token = $1
       AND recovery_token <> ''
       AND recovery_sent_at > now() - interval '1 hour'
       AND deleted_at IS NULL
     LIMIT 1`,
    [token]
  );
  return rows[0] || null;
}

/** True while a forgot-password email is still valid for this user. */
export function userHasActiveRecovery(row: { recovery_token?: string | null; recovery_sent_at?: string | Date | null }) {
  if (!row?.recovery_token) return false;
  if (!row.recovery_sent_at) return false;
  const sent = new Date(row.recovery_sent_at).getTime();
  if (Number.isNaN(sent)) return false;
  return Date.now() - sent < 60 * 60 * 1000;
}

export async function touchSignIn(userId: string) {
  await query(`UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = $1`, [userId]);
}

export async function sessionPayload(user: AppUser, accessToken: string, expiresInSeconds = 604800) {
  const refresh = await mintRefreshToken(user);
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: expiresInSeconds,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    refresh_token: refresh,
    user: {
      id: user.id,
      aud: user.aud,
      role: user.role,
      email: user.email,
      email_confirmed_at: user.email_confirmed_at,
      phone: user.phone,
      confirmed_at: user.email_confirmed_at,
      last_sign_in_at: new Date().toISOString(),
      app_metadata: user.app_metadata,
      user_metadata: user.user_metadata,
      identities: [],
      created_at: user.created_at,
      updated_at: user.updated_at,
      is_anonymous: false,
    },
  };
}

export { rowToUser };
