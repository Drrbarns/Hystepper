import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(req: Request) {
    try {
        const clientId = getClientIdentifier(req);
        const rl = checkRateLimit(`paystack-init:${clientId}`, RATE_LIMITS.payment);
        if (!rl.success) {
            return NextResponse.json(
                { success: false, message: 'Too many payment attempts. Please wait a moment.' },
                { status: 429 }
            );
        }

        const body = await req.json();
        const { orderId, customerEmail, customerPhone } = body;

        if (!orderId || typeof orderId !== 'string') {
            return NextResponse.json({ success: false, message: 'Missing or invalid orderId' }, { status: 400 });
        }

        const secretKey = process.env.PAYSTACK_SECRET_KEY;

        if (!secretKey) {
            console.error('Missing PAYSTACK_SECRET_KEY');
            return NextResponse.json({ success: false, message: 'Payment gateway configuration error' }, { status: 500 });
        }

        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
        const orderQuery = supabaseAdmin
            .from('orders')
            .select('id, order_number, total, email, payment_status, metadata');

        const { data: order, error: orderError } = isUUID
            ? await orderQuery.eq('id', orderId).single()
            : await orderQuery.eq('order_number', orderId).single();

        if (orderError || !order) {
            console.error('[Paystack] Order not found:', orderId);
            return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
        }

        if (order.payment_status === 'paid') {
            return NextResponse.json({ success: false, message: 'Order is already paid' }, { status: 400 });
        }

        const payableNow = Number(order.metadata?.payable_now);
        const amount =
            Number.isFinite(payableNow) && payableNow > 0 ? payableNow : Number(order.total);
        if (!amount || amount <= 0) {
            return NextResponse.json({ success: false, message: 'Invalid order amount' }, { status: 400 });
        }

        const orderRef = order.order_number || orderId;

        const requestUrl = new URL(req.url);
        const baseUrl = requestUrl.origin;

        const email = customerEmail && customerEmail.includes('@')
            ? customerEmail
            : order.email && order.email.includes('@')
              ? order.email
              : `guest-${customerPhone || 'unknown'}@hystepper.com`;

        const payload: any = {
            email,
            amount: Math.round(amount * 100),
            currency: 'GHS',
            reference: `PAY-${orderRef}-${Date.now()}`,
            callback_url: `${baseUrl}/api/payment/paystack/callback?order=${orderRef}`,
            metadata: {
                order_id: orderRef,
                customer_phone: customerPhone,
            }
        };

        console.log('[Paystack] Initiating payment for order:', orderRef, '| Amount:', amount);

        const response = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${secretKey}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.status && result.data?.authorization_url) {
            return NextResponse.json({
                success: true,
                url: result.data.authorization_url,
                reference: result.data.reference,
                access_code: result.data.access_code
            });
        }

        return NextResponse.json({
            success: false,
            message: result.message || 'Failed to initialize payment'
        }, { status: 400 });

    } catch (error: any) {
        console.error('Paystack Payment API Error:', error);
        return NextResponse.json({ success: false, message: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
