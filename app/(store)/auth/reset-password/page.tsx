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

export default function ResetPasswordPage() {
  const router = useRouter();
  const [linkReady, setLinkReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Email links: /auth/reset-password#access_token=<token>&type=recovery
  // We stash the raw recovery token and set the password via a dedicated API
  // so a leftover login session can never force "current password required".
  useEffect(() => {
    const { token, type } = readRecoveryParams();
    if (token && (type === 'recovery' || !type)) {
      stashRecoveryToken(token);
      window.history.replaceState(null, '', window.location.pathname);
      setLinkReady(true);
      // Best-effort: also mint a recovery session for other auth listeners.
      void supabase.auth.verifyOtp({ type: 'recovery', token_hash: token }).catch(() => {});
      return;
    }
    if (readStashedRecoveryToken()) {
      setLinkReady(true);
      return;
    }
    setLinkReady(false);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
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
        throw new Error(json?.error || 'Failed to update password.');
      }

      clearStashedRecoveryToken();
      // Drop any leftover session so they sign in fresh with the new password.
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
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Set a new password</h1>
          <p className="text-gray-600">
            Choose a strong password to secure your account. Your old password is not required.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-8">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
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
