'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PasswordStrengthMeter from '@/components/PasswordStrengthMeter';
import { supabase } from '@/lib/supabase';
import BrandLogo from '@/components/BrandLogo';

function isValidGhanaPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^(\+233|0)\d{9}$/.test(cleaned);
}

export default function SignupPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
    newsletter: false
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<any>({});
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [awaitingOtp, setAwaitingOtp] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpInfo, setOtpInfo] = useState('');

  const authBase = () => (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');

  // e.g. /auth/signup?redirect=/checkout — after verify, land back there signed in.
  const postSignupPath = () => {
    if (typeof window === 'undefined') return '/account';
    const target = new URLSearchParams(window.location.search).get('redirect') || '';
    return target.startsWith('/') && !target.startsWith('//') ? target : '/account';
  };

  const fromCheckout = () => {
    if (typeof window === 'undefined') return false;
    return (new URLSearchParams(window.location.search).get('redirect') || '').startsWith('/checkout');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setAuthError('');
    setIsLoading(true);

    const newErrors: any = {};
    if (!formData.firstName) newErrors.firstName = 'First name is required';
    if (!formData.lastName) newErrors.lastName = 'Last name is required';
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }
    if (!formData.phone) {
      newErrors.phone = 'Phone number is required';
    } else if (!isValidGhanaPhone(formData.phone)) {
      newErrors.phone = 'Enter a valid Ghanaian phone number (e.g. 0241234567)';
    }
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    if (!formData.acceptTerms) {
      newErrors.acceptTerms = 'You must accept the terms and conditions';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          emailRedirectTo: `${window.location.origin}${postSignupPath()}`,
          data: {
            first_name: formData.firstName,
            last_name: formData.lastName,
            phone: formData.phone,
            newsletter: formData.newsletter,
          },
        },
      });

      if (error) throw error;

      if (data.user) {
        if (!data.session || !data.user.email_confirmed_at) {
          setAwaitingOtp(true);
          setOtpInfo(
            `We sent a 6-digit code to ${formData.phone}. Enter it below to activate your account. If it doesn’t arrive within a minute, tap Resend SMS code.`
          );
          setIsLoading(false);
          return;
        }

        fetch('/api/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'welcome',
            payload: { email: formData.email, firstName: formData.firstName },
          }),
        }).catch(err => console.error('Welcome notification error:', err));

        router.push(postSignupPath());
        router.refresh();
      }
    } catch (err: any) {
      console.error('Signup error:', err);
      setAuthError(err.message || 'Failed to sign up.');
    } finally {
      setIsLoading(false);
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
        fetch('/api/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'welcome',
            payload: { email: formData.email, firstName: formData.firstName, phone: formData.phone },
          }),
        }).catch(err => console.error('Welcome notification error:', err));
        router.push(postSignupPath());
        router.refresh();
        return;
      }
      setAuthError('Verification succeeded but no session was created. Please sign in.');
    } catch (err: any) {
      console.error('OTP verify error:', err);
      setAuthError(err.message || 'Invalid or expired code. Try again or resend.');
    } finally {
      setIsLoading(false);
    }
  };

  const resendOtp = async () => {
    setAuthError('');
    setOtpInfo('');
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
        throw new Error(payload.message || payload.error_description || 'Could not resend code');
      }
      setOtpInfo('If this account needs verification, a new SMS code was sent.');
    } catch (err: any) {
      setAuthError(err.message || 'Could not resend right now. Please try again in a moment.');
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="mb-5">
            <BrandLogo className="h-14 w-auto max-w-[220px] object-contain mx-auto" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Create Account</h1>
          <p className="text-gray-600">
            {fromCheckout()
              ? 'Create your account, then we’ll bring you back to finish checkout'
              : 'Join us and start shopping today'}
          </p>
        </div>

        {awaitingOtp ? (
          <div className="bg-white rounded-xl shadow-sm p-8">
            <div className="w-16 h-16 mx-auto mb-4 bg-emerald-100 rounded-full flex items-center justify-center">
              <i className="ri-smartphone-line text-3xl text-emerald-600"></i>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">Verify your phone</h2>
            <p className="text-gray-600 mb-6 text-center">
              {otpInfo || `Enter the 6-digit code we sent to ${formData.phone}.`}
            </p>

            {authError && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {authError}
              </div>
            )}

            <form onSubmit={verifyOtp} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  SMS verification code
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
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || otp.length !== 6}
                className="w-full bg-gold-600 hover:bg-gold-700 text-white py-4 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center">
                    <i className="ri-loader-4-line animate-spin mr-2"></i> Verifying...
                  </span>
                ) : 'Verify & continue'}
              </button>
            </form>

            <button
              type="button"
              onClick={resendOtp}
              className="block w-full mt-4 text-sm text-emerald-700 hover:text-emerald-900 font-medium underline"
            >
              Resend SMS code
            </button>
            <p className="text-sm text-gray-500 mt-4 text-center">
              Code expires in 10 minutes. Wrong number?{' '}
              <button
                type="button"
                onClick={() => {
                  setAwaitingOtp(false);
                  setOtp('');
                  setAuthError('');
                }}
                className="underline font-medium text-gray-700"
              >
                Go back
              </button>
            </p>
          </div>
        ) : (
        <div className="bg-white rounded-xl shadow-sm p-8">
          {authError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {authError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  First Name
                </label>
                <input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-gold-500 ${errors.firstName ? 'border-red-500' : 'border-gray-300'
                    }`}
                  placeholder="John"
                />
                {errors.firstName && (
                  <p className="text-sm text-red-600 mt-1">{errors.firstName}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Last Name
                </label>
                <input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-gold-500 ${errors.lastName ? 'border-red-500' : 'border-gray-300'
                    }`}
                  placeholder="Doe"
                />
                {errors.lastName && (
                  <p className="text-sm text-red-600 mt-1">{errors.lastName}</p>
                )}
              </div>
            </div>

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
                Phone Number
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-gold-500 ${errors.phone ? 'border-red-500' : 'border-gray-300'}`}
                placeholder="024 XXX XXXX"
              />
              <p className="text-xs text-gray-500 mt-1">We&apos;ll text a verification code to this number.</p>
              {errors.phone && (
                <p className="text-sm text-red-600 mt-1">{errors.phone}</p>
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
                  placeholder="At least 6 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <i className={`${showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} text-xl`}></i>
                </button>
              </div>
              <PasswordStrengthMeter password={formData.password} />
              {errors.password && (
                <p className="text-sm text-red-600 mt-2">{errors.password}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className={`w-full px-4 py-3 pr-12 border-2 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-gold-500 ${errors.confirmPassword ? 'border-red-500' : 'border-gray-300'
                    }`}
                  placeholder="Re-enter password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <i className={`${showConfirmPassword ? 'ri-eye-off-line' : 'ri-eye-line'} text-xl`}></i>
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-sm text-red-600 mt-2">{errors.confirmPassword}</p>
              )}
            </div>

            <div>
              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.acceptTerms}
                  onChange={(e) => setFormData({ ...formData, acceptTerms: e.target.checked })}
                  className="w-4 h-4 mt-1 text-gold-600 rounded focus:ring-gold-500"
                />
                <span className="text-sm text-gray-700">
                  I agree to the{' '}
                  <Link href="/terms" className="text-gold-600 hover:text-gold-700 font-medium whitespace-nowrap">
                    Terms & Conditions
                  </Link>
                  {' '}and{' '}
                  <Link href="/privacy" className="text-gold-600 hover:text-gold-700 font-medium whitespace-nowrap">
                    Privacy Policy
                  </Link>
                </span>
              </label>
              {errors.acceptTerms && (
                <p className="text-sm text-red-600 mt-2">{errors.acceptTerms}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gold-600 hover:bg-gold-700 text-white py-4 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <i className="ri-loader-4-line animate-spin mr-2"></i> Creating account...
                </span>
              ) : 'Create Account'}
            </button>
          </form>

          <p className="mt-8 text-center text-gray-600">
            Already have an account?{' '}
            <Link
              href={fromCheckout() ? '/auth/login?redirect=/checkout' : '/auth/login'}
              className="text-gold-600 hover:text-gold-700 font-semibold whitespace-nowrap"
            >
              Sign in
            </Link>
          </p>
        </div>
        )}

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
