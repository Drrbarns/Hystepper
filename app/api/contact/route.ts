import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const clientId = getClientIdentifier(req);
  const rl = checkRateLimit(`contact-form:${clientId}`, {
    maxRequests: 6,
    windowSeconds: 600,
  });
  if (!rl.success) {
    return NextResponse.json(
      { success: false, error: 'Too many messages. Please try again later.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim() || null;
  const subject = String(body.subject || '').trim();
  const message = String(body.message || '').trim();

  if (
    name.length < 1 ||
    name.length > 100 ||
    subject.length < 1 ||
    subject.length > 200 ||
    message.length < 1 ||
    message.length > 5000 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(email)
  ) {
    return NextResponse.json(
      { success: false, error: 'Please fill in all required fields with valid values.' },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin.from('contact_submissions').insert({
    name,
    email,
    phone,
    subject,
    message,
  });

  if (error) {
    console.error('[contact]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send message. Please try again or contact us directly.' },
      { status: 500 },
    );
  }

  // Best-effort inbox notification — never fail the form if email/SMS is down.
  fetch(new URL('/api/notifications', req.url).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'contact',
      payload: { name, email, phone, subject, message },
    }),
  }).catch((err) => console.error('[contact] notification error:', err));

  return NextResponse.json({ success: true });
}
