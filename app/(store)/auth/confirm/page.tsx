'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function ConfirmEmailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Confirming your email…');

  useEffect(() => {
    const token = searchParams.get('token') || searchParams.get('token_hash') || '';

    if (!token) {
      setStatus('error');
      setMessage('This confirmation link is missing a token. Please use the link from your email.');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
        const res = await fetch(`${base}/auth/v1/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
          },
          body: JSON.stringify({ token, token_hash: token, type: 'signup' }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.message || body.error_description || 'Confirmation failed');
        }

        if (body.access_token) {
          await supabase.auth.setSession({
            access_token: body.access_token,
            refresh_token: body.refresh_token || body.access_token,
          });
        }

        if (cancelled) return;

        // Welcome email only after the account is actually verified.
        const confirmedEmail = body?.user?.email;
        const firstName = body?.user?.user_metadata?.first_name;
        if (confirmedEmail) {
          fetch('/api/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'welcome',
              payload: { email: confirmedEmail, firstName },
            }),
          }).catch(() => {});
        }

        setStatus('success');
        setMessage('Your email is confirmed! Redirecting you to your account…');
        setTimeout(() => {
          router.push('/account');
          router.refresh();
        }, 1500);
      } catch (err: any) {
        if (cancelled) return;
        setStatus('error');
        setMessage(err?.message || 'This confirmation link is invalid or has expired.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, router]);

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm p-8 text-center">
        {status === 'loading' && (
          <>
            <div className="w-16 h-16 mx-auto mb-4 bg-emerald-50 rounded-full flex items-center justify-center">
              <i className="ri-loader-4-line text-3xl text-emerald-600 animate-spin"></i>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Confirming email</h1>
            <p className="text-gray-600">{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="w-16 h-16 mx-auto mb-4 bg-emerald-100 rounded-full flex items-center justify-center">
              <i className="ri-checkbox-circle-line text-3xl text-emerald-600"></i>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Email confirmed</h1>
            <p className="text-gray-600">{message}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
              <i className="ri-error-warning-line text-3xl text-red-600"></i>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Couldn’t confirm</h1>
            <p className="text-gray-600 mb-6">{message}</p>
            <div className="flex flex-col gap-3">
              <Link
                href="/auth/login"
                className="inline-block px-6 py-3 bg-gray-900 text-white rounded-lg font-semibold hover:bg-gray-800"
              >
                Go to sign in
              </Link>
              <Link href="/auth/signup" className="text-sm text-gray-500 hover:text-gray-800 underline">
                Create a new account
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function ConfirmEmailPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gray-50 flex items-center justify-center">
          <p className="text-gray-500">Loading…</p>
        </main>
      }
    >
      <ConfirmEmailInner />
    </Suspense>
  );
}
