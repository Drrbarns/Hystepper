import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isModuleEnabledServer } from '@/lib/store-modules-server';
import { requireStaff } from '@/lib/require-staff';
import { escapeHtml, isValidEmail } from '@/lib/sanitize';
import {
    sendOrderConfirmation,
    sendOrderStatusUpdate,
    sendWelcomeMessage,
    sendContactMessage,
    sendPaymentLink,
    sendPosAdminAlert,
    sendEmail,
    sendSMS,
    emailLayout,
} from '@/lib/notifications';
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit';

const ADMIN_ONLY_TYPES = new Set([
    'order_status',
    'order_updated',
    'payment_link',
    'campaign',
    'pos_admin_alert',
]);

/**
 * Single notification fan-out endpoint.
 *
 * Security model:
 * - `order_created` / `order_confirmation`: public with recent-order guard
 * - `contact`: public but rate-limited
 * - Admin types: require staff JWT via requireStaff
 */

export async function POST(request: Request) {
    try {
        const clientId = getClientIdentifier(request);
        const rateLimitResult = checkRateLimit(`notification:${clientId}`, RATE_LIMITS.notification);
        if (!rateLimitResult.success) {
            return NextResponse.json(
                { error: 'Too many requests. Please try again later.' },
                {
                    status: 429,
                    headers: {
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': String(rateLimitResult.resetIn),
                    },
                }
            );
        }

        const body = await request.json().catch(() => ({}));
        const { type, payload } = body || {};

        if (!type || !payload) {
            return NextResponse.json({ error: 'type and payload are required' }, { status: 400 });
        }

        if (ADMIN_ONLY_TYPES.has(type)) {
            const staffAuth = await requireStaff(request);
            if (staffAuth instanceof NextResponse) return staffAuth;
        }

        // --------------------------------------------------------------
        // order_created — verify the order exists & is recent
        // --------------------------------------------------------------
        if (type === 'order_created' || type === 'order_confirmation') {
            const orderRef = payload.order_number || payload.id;
            if (!orderRef) {
                return NextResponse.json({ error: 'Missing order identifier' }, { status: 400 });
            }

            let existing: any = null;
            const byNumber = await supabaseAdmin
                .from('orders')
                .select('id, order_number, created_at')
                .eq('order_number', orderRef)
                .maybeSingle();
            if (byNumber.data) {
                existing = byNumber.data;
            } else {
                const byId = await supabaseAdmin
                    .from('orders')
                    .select('id, order_number, created_at')
                    .eq('id', orderRef)
                    .maybeSingle();
                existing = byId.data;
            }

            if (!existing) {
                return NextResponse.json({ error: 'Order not found' }, { status: 404 });
            }

            const orderAgeMs = Date.now() - new Date(existing.created_at).getTime();
            if (orderAgeMs > 10 * 60 * 1000) {
                return NextResponse.json(
                    { error: 'Order confirmation can only be sent for recently created orders' },
                    { status: 400 }
                );
            }

            await sendOrderConfirmation(payload);
            return NextResponse.json({ success: true, message: 'Order confirmation sent' });
        }

        // --------------------------------------------------------------
        // order_updated — legacy shape: { order, status }
        // --------------------------------------------------------------
        if (type === 'order_updated') {
            const { order, status } = payload;
            if (!order || !status) {
                return NextResponse.json({ error: 'Missing order or status' }, { status: 400 });
            }
            await sendOrderStatusUpdate(order, status);
            return NextResponse.json({ success: true, message: 'Status update sent' });
        }

        // --------------------------------------------------------------
        // order_status — admin panel shape: { orderNumber, status, ... }
        // --------------------------------------------------------------
        if (type === 'order_status') {
            const { orderNumber, status, trackingNumber, email, name, phone } = payload;
            if (!orderNumber || !status) {
                return NextResponse.json({ error: 'orderNumber and status are required' }, { status: 400 });
            }

            const { data: fullOrder } = await supabaseAdmin
                .from('orders')
                .select('id, order_number, email, phone, shipping_address, metadata')
                .eq('order_number', orderNumber)
                .maybeSingle();

            const orderForNotification = fullOrder || {
                order_number: orderNumber,
                email,
                phone,
                shipping_address: { firstName: name, phone },
                metadata: trackingNumber ? { tracking_number: trackingNumber } : {},
            };

            if (!orderForNotification.phone && phone) {
                orderForNotification.phone = phone;
            }
            if (trackingNumber && !orderForNotification.metadata?.tracking_number) {
                orderForNotification.metadata = {
                    ...(orderForNotification.metadata || {}),
                    tracking_number: trackingNumber,
                };
            }

            await sendOrderStatusUpdate(orderForNotification, status);
            return NextResponse.json({ success: true, message: 'Status update sent' });
        }

        // --------------------------------------------------------------
        // welcome — authenticated user sending to their own email only
        // --------------------------------------------------------------
        if (type === 'welcome') {
            if (!payload.email || !isValidEmail(payload.email)) {
                return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
            }

            const { verifyAccessToken } = await import('@/server/auth');
            const auth = request.headers.get('authorization') || '';
            const token = auth.replace(/^Bearer\s+/i, '').trim();
            const verified = token ? await verifyAccessToken(token) : null;
            if (!verified?.sub) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }

            const { findUserById } = await import('@/server/auth');
            const user = await findUserById(verified.sub);
            const userEmail = String(user?.email || '').trim().toLowerCase();
            if (!userEmail || userEmail !== String(payload.email).trim().toLowerCase()) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }

            const welcomeEnabled = await isModuleEnabledServer('welcome-emails');
            if (!welcomeEnabled) {
                return NextResponse.json({ success: true, skipped: true, message: 'Welcome emails module disabled' });
            }

            await sendWelcomeMessage(payload);
            return NextResponse.json({ success: true, message: 'Welcome message sent' });
        }

        // --------------------------------------------------------------
        // contact — public-facing
        // --------------------------------------------------------------
        if (type === 'contact') {
            const { name, email, subject, message } = payload;
            if (!name || !email || !subject || !message) {
                return NextResponse.json({ error: 'All contact fields are required' }, { status: 400 });
            }
            if (!isValidEmail(email)) {
                return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
            }
            if (name.length > 100 || subject.length > 200 || message.length > 5000) {
                return NextResponse.json({ error: 'Input exceeds length limits' }, { status: 400 });
            }
            await sendContactMessage(payload);
            return NextResponse.json({ success: true, message: 'Contact message sent' });
        }

        // --------------------------------------------------------------
        // pos_admin_alert
        // --------------------------------------------------------------
        if (type === 'pos_admin_alert') {
            const { orderId, orderNumber, total, orderType, paymentMethod, customerName, customerPhone } = payload || {};
            if (!orderId || !orderNumber) {
                return NextResponse.json({ error: 'orderId and orderNumber are required' }, { status: 400 });
            }

            const { data: existing } = await supabaseAdmin
                .from('orders')
                .select('id, created_at, payment_provider, metadata')
                .eq('id', orderId)
                .maybeSingle();
            if (!existing) {
                return NextResponse.json({ error: 'Order not found' }, { status: 404 });
            }
            const orderAgeMs = Date.now() - new Date(existing.created_at).getTime();
            const isPos =
                existing.payment_provider === 'pos' ||
                existing.metadata?.pos_sale === true;
            if (!isPos || orderAgeMs > 10 * 60 * 1000) {
                return NextResponse.json({ error: 'Not a recent POS order' }, { status: 400 });
            }

            await sendPosAdminAlert({
                orderId,
                orderNumber: String(orderNumber),
                total: Number(total) || 0,
                orderType: orderType === 'delivery' ? 'delivery' : 'walk_in',
                paymentMethod: String(paymentMethod || 'cash'),
                customerName: customerName ? String(customerName) : undefined,
                customerPhone: customerPhone ? String(customerPhone) : undefined,
            });
            return NextResponse.json({ success: true, message: 'POS admin alert sent' });
        }

        // --------------------------------------------------------------
        // payment_link
        // --------------------------------------------------------------
        if (type === 'payment_link') {
            if (!payload.id || !payload.order_number) {
                return NextResponse.json({ error: 'Missing order details' }, { status: 400 });
            }
            await sendPaymentLink(payload);
            return NextResponse.json({ success: true, message: 'Payment link sent' });
        }

        // --------------------------------------------------------------
        // campaign — bulk fan-out, admin-initiated
        // --------------------------------------------------------------
        if (type === 'campaign') {
            const { recipients, subject, message, channels } = payload;
            if (!Array.isArray(recipients) || recipients.length === 0) {
                return NextResponse.json({ error: 'Recipients required' }, { status: 400 });
            }
            if (!subject || !message) {
                return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 });
            }

            const seenEmails = new Set<string>();
            const seenPhones = new Set<string>();
            const safeSubject = escapeHtml(subject);
            const safeMessage = escapeHtml(message);
            const results = { email: 0, sms: 0, errors: 0 };

            for (const recipient of recipients) {
                try {
                    if (channels?.email && recipient.email) {
                        const key = recipient.email.toLowerCase().trim();
                        if (!seenEmails.has(key)) {
                            seenEmails.add(key);
                            const recipientName = escapeHtml(recipient.name || 'Valued Customer');
                            const brandedHtml = emailLayout(
                                `
<h2 style="margin:0 0 16px;color:#111827;font-size:22px;text-align:center;">${safeSubject}</h2>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:16px 0;">Hi ${recipientName},</p>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px;">${safeMessage.replace(/\n/g, '</p><p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px;">')}</p>
`,
                                safeSubject
                            );
                            await sendEmail({ to: recipient.email, subject, html: brandedHtml });
                            results.email++;
                        }
                    }
                    if (channels?.sms && recipient.phone) {
                        const phoneKey = recipient.phone.replace(/[\s\-().]+/g, '');
                        if (!seenPhones.has(phoneKey)) {
                            seenPhones.add(phoneKey);
                            await sendSMS({ to: recipient.phone, message });
                            results.sms++;
                        }
                    }
                } catch (err: any) {
                    console.error('[Campaign] Failed for recipient:', err?.message || err);
                    results.errors++;
                }
            }

            return NextResponse.json({
                success: true,
                message: `Campaign sent: ${results.email} emails, ${results.sms} SMS${results.errors ? ` (${results.errors} failed)` : ''}.`,
            });
        }

        return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 });
    } catch (error: any) {
        console.error('[Notifications] API error:', error?.message || error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
