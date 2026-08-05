import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const clientId = getClientIdentifier(req);
  const rl = checkRateLimit(`newsletter:${clientId}`, {
    maxRequests: 8,
    windowSeconds: 600,
  });
  if (!rl.success) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Please try again later.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const source = String(body.source || 'footer').trim().slice(0, 40) || 'footer';

  // Same shape as the storefront client check ([[:space:]]-safe).
  if (!email || email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(email)) {
    return NextResponse.json(
      { success: false, error: 'Enter a valid email address.' },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from('newsletter_subscribers')
    .upsert(
      { email, source, is_active: true },
      { onConflict: 'email' },
    );

  if (error) {
    console.error('[newsletter/subscribe]', error);
    return NextResponse.json(
      { success: false, error: 'Could not subscribe right now. Please try again.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
