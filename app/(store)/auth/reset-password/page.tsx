'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const RECOVERY_TOKEN_KEY = 'hs-recovery-token';

function readRecoveryParams() {
  if (typeof window === 'undefined') return { token: '', type: '' };
  const hash = window.location.hash.replace(/^#/, '');
  const search = window.location.search.replace(/^\?/, '');
  const hashParams = new URLSearchParams(hash);
  const queryParams = new URLSearchParams(search);
  const token =
    hashParams.get('access_token') ||
    hashParams.get('token') ||
    queryParams.get('access_token') ||
    queryParams.get('token') ||
    '';
  const type = hashParams.get('type') || queryParams.get('type') || '';
  return { token, type };
}

function stashRecoveryToken(token: string) {
  try {
    sessionStorage.setItem(RECOVERY_TOKEN_KEY, token);
  } catch { /* private mode */ }
}

function readStashedRecoveryToken(): string {
  try {
    return sessionStorage.getItem(RECOVERY_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function clearStashedRecoveryToken() {
  try {
    sessionStorage.removeItem(RECOVERY_TOKEN_KEY);
  } catch { /* ignore */ }
}

type Step = 'otp' | 'password';
type OtpChannel = 'email' | 'sms';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [linkReady, setLinkReady] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>('otp');
  const [channel, setChannel] = useState<OtpChannel>('email');
  const [smsAvailable, setSmsAvailable] = useState(false);
  const [emailHint, setEmailHint] = useState('');
  const [phoneHint, setPhoneHint] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [otpInfo, setOtpInfo] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const sendOtps = async (token: string, nextChannel: OtpChannel = 'email') => {
    setSendingOtp(true);
    setError('');
    try {
      const res = await fetch('/api/auth/recovery/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, channel: nextChannel }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        // Email failed but SMS backup is available — surface that path clearly.
        if (json?.smsAvailable && nextChannel === 'email') {
          setSmsAvailable(true);
          setPhoneHint(json.phoneHint || null);
          setEmailHint(json.emailHint || '');
        }
        throw new Error(json?.error || 'Could not send verification code.');
      }
      const active: OtpChannel = json.channel === 'sms' ? 'sms' : 'email';
      setChannel(active);
      setSmsAvailable(!!json.smsAvailable);
      setEmailHint(json.emailHint || '');
      setPhoneHint(json.phoneHint || null);
      setOtp('');
      setOtpInfo(
        json.message ||
          (active === 'sms'
            ? 'We sent a code by SMS.'
            : 'We sent a code to your email.'),
      );
    } catch (err: any) {
      setError(err?.message || 'Could not send verification code.');
    } finally {
      setSendingOtp(false);
    }
  };

  // Email links: /auth/reset-password#access_token=<token>&type=recovery
  useEffect(() => {
    const { token, type } = readRecoveryParams();
    const readyToken =
      token && (type === 'recovery' || !type) ? token : readStashedRecoveryToken();

    if (token && (type === 'recovery' || !type)) {
      stashRecoveryToken(token);
      window.history.replaceState(null, '', window.location.pathname);
      void supabase.auth.verifyOtp({ type: 'recovery', token_hash: token }).catch(() => {});
    }

    if (!readyToken) {
      setLinkReady(false);
      return;
    }

    setLinkReady(true);
    void sendOtps(readyToken, 'email');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const token = readStashedRecoveryToken();
    if (!token) {
      setError('Reset link is missing or expired. Please request a new one.');
      setLinkReady(false);
      return;
    }
    if (!/^\d{6}$/.test(otp.replace(/\D/g, ''))) {
      setError(channel === 'sms'
        ? 'Enter the 6-digit code from your SMS.'
        : 'Enter the 6-digit code from your email.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/recovery/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          otp: otp.replace(/\D/g, ''),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Invalid or expired code.');
      }
      setStep('password');
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Invalid or expired code.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    const token = readStashedRecoveryToken();
    if (!token) {
      setError('Reset link is missing or expired. Please request a new one.');
      setLinkReady(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, token }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        if (json?.code === 'otp_required') {
          setStep('otp');
        }
        throw new Error(json?.error || 'Failed to update password.');
      }

      clearStashedRecoveryToken();
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch { /* ignore */ }

      setSuccess(true);
      setTimeout(() => {
        router.push('/auth/login');
        router.refresh();
      }, 1500);
    } catch (err: any) {
      console.error('Password update error:', err);
      setError(err?.message || 'Failed to update password.');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6">
        <div className="max-w-md w-full text-center bg-white rounded-xl shadow-sm p-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-100 flex items-center justify-center">
            <i className="ri-checkbox-circle-line text-3xl text-emerald-700"></i>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Password updated</h1>
          <p className="text-gray-600">You can sign in with your new password.</p>
        </div>
      </main>
    );
  }

  if (linkReady === null) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6">
        <div className="text-center text-gray-600">
          <i className="ri-loader-4-line animate-spin text-3xl text-gold-600"></i>
          <p className="mt-3 text-sm">Checking your reset link…</p>
        </div>
      </main>
    );
  }

  if (linkReady === false) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6">
        <div className="max-w-md w-full text-center bg-white rounded-xl shadow-sm p-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
            <i className="ri-error-warning-line text-3xl text-amber-700"></i>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Reset link invalid or expired</h1>
          <p className="text-gray-600 mb-6">
            Password reset links expire after one hour. Request a new one — you will not need your old password.
          </p>
          <Link
            href="/auth/forgot-password"
            className="inline-block bg-gold-600 hover:bg-gold-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
          >
            Request a new link
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            {step === 'otp' ? "Verify it's you" : 'Set a new password'}
          </h1>
          <p className="text-gray-600">
            {step === 'otp'
              ? channel === 'sms'
                ? 'Enter the SMS code we sent to your phone, then choose a new password.'
                : 'Enter the code we sent to your email, then choose a new password.'
              : 'Choose a strong password to secure your account. Your old password is not required.'}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-8">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          {step === 'otp' ? (
            <form onSubmit={handleVerifyOtp} className="space-y-6">
              {otpInfo && (
                <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  {otpInfo}
                </p>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  {channel === 'sms' ? (
                    <>
                      SMS code{' '}
                      {phoneHint ? <span className="font-normal text-gray-500">({phoneHint})</span> : null}
                    </>
                  ) : (
                    <>
                      Email code{' '}
                      {emailHint ? <span className="font-normal text-gray-500">({emailHint})</span> : null}
                    </>
                  )}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg text-center text-2xl tracking-[0.4em] font-semibold focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
                  placeholder="••••••"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || otp.length !== 6}
                className="w-full bg-gold-600 hover:bg-gold-700 text-white py-4 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isLoading ? 'Verifying…' : 'Continue'}
              </button>

              <div className="space-y-2 text-center">
                <button
                  type="button"
                  disabled={sendingOtp}
                  onClick={() => {
                    const token = readStashedRecoveryToken();
                    if (token) void sendOtps(token, channel);
                  }}
                  className="w-full py-2 text-sm font-semibold text-gold-600 hover:text-gold-700 disabled:opacity-50 cursor-pointer"
                >
                  {sendingOtp
                    ? 'Sending…'
                    : channel === 'sms'
                      ? 'Resend SMS code'
                      : 'Resend email code'}
                </button>

                {channel === 'email' && smsAvailable && (
                  <button
                    type="button"
                    disabled={sendingOtp}
                    onClick={() => {
                      const token = readStashedRecoveryToken();
                      if (token) void sendOtps(token, 'sms');
                    }}
                    className="w-full py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 cursor-pointer"
                  >
                    Didn&apos;t get the email? Send code by SMS
                    {phoneHint ? ` (${phoneHint})` : ''}
                  </button>
                )}

                {channel === 'sms' && (
                  <button
                    type="button"
                    disabled={sendingOtp}
                    onClick={() => {
                      const token = readStashedRecoveryToken();
                      if (token) void sendOtps(token, 'email');
                    }}
                    className="w-full py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 cursor-pointer"
                  >
                    Prefer email? Send code to {emailHint || 'your email'}
                  </button>
                )}
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmitPassword} className="space-y-6">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800 flex items-center gap-2">
                <i className="ri-shield-check-line"></i>
                Identity verified — set your new password below.
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">New Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <i className={`${showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} text-xl`}></i>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">Confirm Password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full px-4 py-3 pr-12 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    <i className={`${showConfirm ? 'ri-eye-off-line' : 'ri-eye-line'} text-xl`}></i>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gold-600 hover:bg-gold-700 text-white py-4 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
              >
                {isLoading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>

        <div className="mt-8 text-center">
          <Link href="/auth/login" className="text-gray-600 hover:text-gray-900 font-medium whitespace-nowrap">
            <i className="ri-arrow-left-line mr-2"></i>
            Back to Sign In
          </Link>
        </div>
      </div>
    </main>
  );
}
