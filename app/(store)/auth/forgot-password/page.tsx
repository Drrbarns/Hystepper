'use client';

import Link from 'next/link';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email) {
      setError('Email is required');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError('Please enter a valid email');
      return;
    }

    setIsLoading(true);
    try {
      // Build the absolute redirect URL so the recovery link in the email
      // brings the user back to /auth/reset-password on the right host
      // (works in dev, preview, and production).
      const redirectTo =
        typeof window !== 'undefined'
          ? `${window.location.origin}/auth/reset-password`
          : undefined;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (resetError) throw resetError;
      setIsSubmitted(true);
    } catch (err: any) {
      console.error('Password reset error:', err);
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-emerald-100 rounded-full mx-auto mb-6">
              <i className="ri-mail-send-line text-3xl text-emerald-700"></i>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">Check Your Email</h1>
            <p className="text-gray-600 mb-6">
              If an account exists for <strong>{email}</strong> we&apos;ve sent a password reset link.
            </p>
            <p className="text-sm text-gray-500 mb-8">
              The link expires in 1 hour. Don&apos;t see the email? Check your spam folder.
            </p>
            <Link
              href="/auth/login"
              className="inline-block bg-gold-600 hover:bg-gold-700 text-white px-8 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap"
            >
              Back to Sign In
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Reset Password</h1>
          <p className="text-gray-600">Enter your email to receive a reset link</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-gold-500 ${
                  error ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="you@example.com"
              />
              {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gold-600 hover:bg-gold-700 text-white py-4 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
            >
              {isLoading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>

          <p className="mt-8 text-center text-gray-600">
            Remember your password?{' '}
            <Link
              href="/auth/login"
              className="text-gold-600 hover:text-gold-700 font-semibold whitespace-nowrap"
            >
              Sign in
            </Link>
          </p>
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
