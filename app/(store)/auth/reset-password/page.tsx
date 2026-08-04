'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [hasRecoverySession, setHasRecoverySession] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // The reset email links here as /auth/reset-password#access_token=<recovery
  // token>&type=recovery. That token is a one-time recovery token — NOT a JWT —
  // so it must be exchanged via /auth/v1/verify for a real session before the
  // form can submit. (Relying on detectSessionInUrl fails: there is no
  // refresh_token in the hash, so supabase-js discards it and getSession()
  // stays empty, which used to make this page claim the link had expired.)
  useEffect(() => {
    let cancelled = false;

    const exchange = async () => {
      const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
      const params = new URLSearchParams(hash);
      const token = params.get('access_token') || params.get('token') || '';
      const type = params.get('type') || '';

      // Already signed in (e.g. second visit after a successful exchange)?
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        if (!cancelled) setHasRecoverySession(true);
        return;
      }

      if (token && type === 'recovery') {
        const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
          type: 'recovery',
          token_hash: token,
        });
        if (!cancelled) {
          if (!verifyError && verified?.session) {
            // Remove the one-time token from the address bar.
            window.history.replaceState(null, '', window.location.pathname);
            setHasRecoverySession(true);
          } else {
            setHasRecoverySession(false);
          }
        }
        return;
      }

      if (!cancelled) setHasRecoverySession(false);
    };

    exchange();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setHasRecoverySession(true);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
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

    setIsLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setSuccess(true);
      setTimeout(() => {
        router.push('/account');
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
          <p className="text-gray-600">Redirecting you to your account…</p>
        </div>
      </main>
    );
  }

  if (hasRecoverySession === false) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6">
        <div className="max-w-md w-full text-center bg-white rounded-xl shadow-sm p-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
            <i className="ri-error-warning-line text-3xl text-amber-700"></i>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Reset link invalid or expired</h1>
          <p className="text-gray-600 mb-6">Please request a new password reset link to continue.</p>
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
          <p className="text-gray-600">Choose a strong password to secure your account</p>
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
