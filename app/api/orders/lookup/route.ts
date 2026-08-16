import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * Public order lookup by exact order_number.
 * Replaces the former broad guest SELECT policy on orders (PII leak).
 * Order numbers are unguessable (ORD-{timestamp}-{random}).
 */
export async function GET(request: Request) {
  try {
    const clientId = getClientIdentifier(request);
    const rl = checkRateLimit(`order-lookup:${clientId}`, RATE_LIMITS.default);
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const url = new URL(request.url);
    const orderNumber = (url.searchParams.get('order') || '').trim();
    if (!orderNumber || orderNumber.length < 8 || orderNumber.length > 80) {
      return NextResponse.json({ error: 'Invalid order reference' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('orders')
      .select(`*, order_items (*)`)
      .eq('order_number', orderNumber)
      .maybeSingle();

    if (error) {
      console.error('[orders/lookup]', error.message);
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    return NextResponse.json({ order: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
