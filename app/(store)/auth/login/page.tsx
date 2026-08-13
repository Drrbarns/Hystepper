'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, setRememberMe } from '@/lib/supabase';
import BrandLogo from '@/components/BrandLogo';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    // Checked by default so returning customers stay signed in unless they
    // explicitly opt out (e.g. on a shared device).
    rememberMe: true
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<any>({});
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [needsPhoneVerify, setNeedsPhoneVerify] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpInfo, setOtpInfo] = useState('');
  const [signupHref, setSignupHref] = useState('/auth/signup');

  const authBase = () => (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');

  // Where to land after signing in. Supports ?redirect=/checkout style links
  // (internal paths only) so e.g. checkout can send customers here and back.
  const postLoginPath = () => {
    if (typeof window === 'undefined') return '/account';
    const target = new URLSearchParams(window.location.search).get('redirect') || '';
    return target.startsWith('/') && !target.startsWith('//') ? target : '/account';
  };

  // Preserve checkout (etc.) redirect when switching to create-account from login.
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get('redirect') || '';
    if (target.startsWith('/') && !target.startsWith('//')) {
      setSignupHref(`/auth/signup?redirect=${encodeURIComponent(target)}`);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setAuthError('');
    setIsLoading(true);

    const newErrors: any = {};
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }
    if (!formData.password) {
      newErrors.password = 'Password is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setIsLoading(false);
      return;
    }

    try {
      // Must be set BEFORE sign-in so the fresh session lands in the right
      // store (localStorage = remembered, sessionStorage = this tab only).
      setRememberMe(formData.rememberMe);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        router.push(postLoginPath());
        router.refresh();
      }
    } catch (error: any) {
      console.error('Login error:', error);
      const msg = String(error?.message || '');
      const code = String(error?.code || error?.error || '');
      if (
        code === 'email_not_confirmed' ||
        /email not confirmed|confirm your email|verify your phone/i.test(msg)
      ) {
        setNeedsPhoneVerify(true);
        setAuthError('');
        setOtpInfo(
          'Your account still needs phone verification. Enter the SMS code we already sent, or tap Resend SMS code.'
        );
      } else {
        setAuthError(msg || 'Failed to sign in. Please check your credentials.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const resendConfirmation = async () => {
    if (!formData.email) {
      setAuthError('Enter your email above, then tap Resend SMS code.');
      return;
    }
    try {
      const res = await fetch(`${authBase()}/auth/v1/resend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
        },
        body: JSON.stringify({ email: formData.email, type: 'sms' }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.message || payload.error_description || 'Could not resend');
      }
      setOtpInfo('If this account needs verification, a new SMS code was sent.');
      setAuthError('');
    } catch (e: any) {
      setAuthError(e?.message || 'Could not resend SMS right now. Please try again shortly.');
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const cleaned = otp.replace(/\D/g, '');
    if (!/^\d{6}$/.test(cleaned)) {
      setAuthError('Enter the 6-digit code from your SMS.');
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: formData.email,
        token: cleaned,
        type: 'signup',
      });
      if (error) throw error;
      if (data.session) {
        router.push(postLoginPath());
        router.refresh();
        return;
      }
      setAuthError('Verified. Please sign in with your password.');
      setNeedsPhoneVerify(false);
    } catch (err: any) {
      setAuthError(err.message || 'Invalid or expired code.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="mb-5">
            <BrandLogo className="h-14 w-auto max-w-[220px] object-contain mx-auto" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Welcome Back</h1>
          <p className="text-gray-600">Sign in to your account to continue</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-8">
          {authError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              <p>{authError}</p>
            </div>
          )}

          {needsPhoneVerify ? (
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-14 h-14 mx-auto mb-3 bg-emerald-100 rounded-full flex items-center justify-center">
                  <i className="ri-smartphone-line text-2xl text-emerald-600"></i>
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Verify your phone</h2>
                <p className="text-sm text-gray-600">{otpInfo}</p>
              </div>
              <form onSubmit={verifyOtp} className="space-y-4">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg text-center text-2xl tracking-[0.4em] font-semibold focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
                  placeholder="••••••"
                />
                <button
                  type="submit"
                  disabled={isLoading || otp.length !== 6}
                  className="w-full bg-gold-600 hover:bg-gold-700 text-white py-4 rounded-lg font-semibold transition-colors disabled:opacity-50"
                >
                  {isLoading ? 'Verifying...' : 'Verify & sign in'}
                </button>
              </form>
              <button
                type="button"
                onClick={() => resendConfirmation()}
                className="block w-full text-sm text-emerald-700 hover:text-emerald-900 font-medium underline"
              >
                Resend SMS code
              </button>
              <button
                type="button"
                onClick={() => {
                  setNeedsPhoneVerify(false);
                  setOtp('');
                  setAuthError('');
                }}
                className="block w-full text-sm text-gray-500 underline"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-gold-500 ${errors.email ? 'border-red-500' : 'border-gray-300'
                      }`}
                    placeholder="you@example.com"
                  />
                  {errors.email && (
                    <p className="text-sm text-red-600 mt-2">{errors.email}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className={`w-full px-4 py-3 pr-12 border-2 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-gold-500 ${errors.password ? 'border-red-500' : 'border-gray-300'
                        }`}
                      placeholder="Enter your password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <i className={`${showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} text-xl`}></i>
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-sm text-red-600 mt-2">{errors.password}</p>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.rememberMe}
                      onChange={(e) => setFormData({ ...formData, rememberMe: e.target.checked })}
                      className="w-4 h-4 text-gold-600 rounded focus:ring-gold-500"
                    />
                    <span className="text-sm text-gray-700">Remember me</span>
                  </label>
                  <Link href="/auth/forgot-password" className="text-sm text-gold-600 hover:text-gold-700 font-medium whitespace-nowrap">
                    Forgot password?
                  </Link>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-gold-600 hover:bg-gold-700 text-white py-4 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center">
                      <i className="ri-loader-4-line animate-spin mr-2"></i> Signing in...
                    </span>
                  ) : 'Sign In'}
                </button>
              </form>

              <p className="mt-8 text-center text-gray-600">
                Don&apos;t have an account?{' '}
                <Link href={signupHref} className="text-gold-600 hover:text-gold-700 font-semibold whitespace-nowrap">
                  Create one now
                </Link>
              </p>
            </>
          )}
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="text-gray-600 hover:text-gray-900 font-medium whitespace-nowrap">
            <i className="ri-arrow-left-line mr-2"></i>
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
