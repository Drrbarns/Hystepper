import { Resend } from 'resend';
import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { escapeHtml, maskPhone, maskEmail } from '@/lib/sanitize';

const resend = new Resend(process.env.RESEND_API_KEY || 'missing_api_key');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hystepper2@gmail.com';

/**
 * Resend can only send from a VERIFIED domain (hystepper.com). A free-mailbox
 * sender like hystepper2@gmail.com is rejected with a validation error, which
 * used to make every order receipt fail silently. If EMAIL_FROM points at a
 * free mailbox, fall back to the verified no-reply sender and keep the gmail
 * address as Reply-To so customer replies still reach the store inbox.
 */
const VERIFIED_FROM = 'Hy_stepper <noreply@hystepper.com>';
// Coolify wraps env values containing spaces in single quotes — strip them.
const stripQuotes = (v: string) => v.trim().replace(/^['"]+|['"]+$/g, '').trim();
const configuredFrom = stripQuotes(process.env.EMAIL_FROM || '');
const fromIsFreeMailbox = /@(gmail|googlemail|yahoo|hotmail|outlook|icloud|aol)\./i.test(configuredFrom);
const EMAIL_FROM = configuredFrom && !fromIsFreeMailbox
    ? configuredFrom
    : stripQuotes(process.env.AUTH_EMAIL_FROM || '') || VERIFIED_FROM;
const EMAIL_REPLY_TO = fromIsFreeMailbox
    ? configuredFrom.replace(/^.*<|>.*$/g, '').trim() || ADMIN_EMAIL
    : ADMIN_EMAIL;

const BRAND = {
    name: 'Hy-Stepper',
    tagline: 'Premium lifestyle & footwear',
    color: '#b58410',
    colorDark: '#7c5703',
    colorLight: '#fef6e4',
    url: (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    phone: process.env.STORE_PHONE || '',
};

// ---------------------------------------------------------------------------
// Reusable branded email shell
// ---------------------------------------------------------------------------

export function emailLayout(body: string, preheader?: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>${BRAND.name}</title>
  ${preheader ? `<span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>` : ''}
</head>
<body style="margin:0;padding:0;background-color:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f1ea;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.07);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND.color},${BRAND.colorDark});padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">${BRAND.name}</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:12px;letter-spacing:1.5px;text-transform:uppercase;">${BRAND.tagline}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr><td style="padding:40px 40px 32px;">${body}</td></tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#faf8f3;padding:24px 40px;border-top:1px solid #eee;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="text-align:center;">
                  ${BRAND.phone ? `<p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Need help? Contact us at <a href="tel:${BRAND.phone}" style="color:${BRAND.color};text-decoration:none;">${BRAND.phone}</a></p>` : ''}
                  <p style="margin:0 0 12px;color:#6b7280;font-size:13px;">
                    <a href="${BRAND.url}" style="color:${BRAND.color};text-decoration:none;">Visit store</a> &nbsp;·&nbsp;
                    <a href="${BRAND.url}/shop" style="color:${BRAND.color};text-decoration:none;">Shop</a> &nbsp;·&nbsp;
                    <a href="${BRAND.url}/contact" style="color:${BRAND.color};text-decoration:none;">Support</a>
                  </p>
                  <p style="margin:0;color:#9ca3af;font-size:11px;">&copy; ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</p>
                </td></tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function emailButton(text: string, href: string, color?: string): string {
    const bg = color || BRAND.color;
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;"><tr>
  <td style="background-color:${bg};border-radius:8px;">
    <a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.3px;">${text}</a>
  </td>
</tr></table>`;
}

function emailInfoRow(label: string, value: string): string {
    return `<tr>
  <td style="padding:10px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #f3f4f6;width:40%;">${label}</td>
  <td style="padding:10px 16px;color:#111827;font-size:14px;font-weight:600;border-bottom:1px solid #f3f4f6;">${value}</td>
</tr>`;
}

function emailShippingNotes(notes: string[]): string {
    if (notes.length === 0) return '';
    return `<div style="background-color:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:14px 16px;margin:20px 0;">
  <p style="font-weight:600;color:#92400e;margin:0 0 6px;font-size:13px;">&#9200; Shipping Notes</p>
  ${notes.map(n => `<p style="color:#78350f;margin:3px 0;font-size:13px;">${escapeHtml(n)}</p>`).join('')}
</div>`;
}

// ---------------------------------------------------------------------------
// Name resolution — used across all notifications
// ---------------------------------------------------------------------------

function resolveCustomerName(order: any): string {
    const sa = order?.shipping_address || {};
    if (sa.full_name) return String(sa.full_name);
    if (sa.firstName) {
        return sa.lastName ? `${sa.firstName} ${sa.lastName}` : String(sa.firstName);
    }
    const md = order?.metadata || {};
    if (md.first_name) {
        return md.last_name ? `${md.first_name} ${md.last_name}` : String(md.first_name);
    }
    return 'Customer';
}

function resolveCustomerPhone(order: any): string | undefined {
    return order?.phone || order?.shipping_address?.phone || order?.metadata?.phone;
}

function trackingUrlFor(orderRef: string): string {
    // Hy-Stepper order-success doubles as tracking: fetches and renders
    // progress for any order_number, logged-in or not.
    return `${BRAND.url}/order-success?order=${orderRef}`;
}

// Build the review URL we send to a customer once an order is delivered.
// If the order contains a single product (the common POS case), link them
// straight to that product's reviews tab so they can leave a review in one
// tap. Multi-item orders get a per-order chooser at /review/order/[ref].
async function resolveReviewUrl(orderId: string, orderRef: string): Promise<string> {
    const fallback = `${BRAND.url}/review/order/${encodeURIComponent(String(orderRef))}`;
    if (!orderId) return fallback;

    try {
        const { data: items } = await supabase
            .from('order_items')
            .select('product_id, products:product_id(slug)')
            .eq('order_id', orderId);

        if (!items || items.length === 0) return fallback;

        const distinctProducts = new Map<string, string>();
        for (const it of items as any[]) {
            const pid = it?.product_id;
            const prod = Array.isArray(it?.products) ? it.products[0] : it?.products;
            const slug = prod?.slug;
            if (pid && slug && !distinctProducts.has(pid)) {
                distinctProducts.set(pid, slug);
            }
        }

        if (distinctProducts.size === 1) {
            const [slug] = distinctProducts.values();
            // ?review=write tells the product page to auto-open the review
            // form; #reviews scrolls past the listing so the form is in view.
            return `${BRAND.url}/product/${slug}?review=write#reviews`;
        }
        return fallback;
    } catch {
        return fallback;
    }
}

// ---------------------------------------------------------------------------
// Idempotency guard — prevents duplicate SMS/email when multiple payment
// paths (moolre callback, moolre verify, paystack webhook, paystack callback)
// all race to confirm the same order.
// ---------------------------------------------------------------------------

async function claimConfirmationSend(orderId: string | undefined): Promise<boolean> {
    if (!orderId) return true;
    try {
        const { data: existing } = await supabaseAdmin
            .from('orders')
            .select('metadata')
            .eq('id', orderId)
            .single();

        if (existing?.metadata?.confirmation_sent_at) {
            console.log(`[Notifications] Skipping duplicate confirmation for ${orderId} (already sent at ${existing.metadata.confirmation_sent_at})`);
            return false;
        }

        const nextMeta = {
            ...(existing?.metadata || {}),
            confirmation_sent_at: new Date().toISOString(),
        };
        await supabaseAdmin.from('orders').update({ metadata: nextMeta }).eq('id', orderId);
        return true;
    } catch (err: any) {
        console.error('[Notifications] claimConfirmationSend error:', err?.message || err);
        return true;
    }
}

// ---------------------------------------------------------------------------
// Primitives: email + SMS
// ---------------------------------------------------------------------------

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
    if (!process.env.RESEND_API_KEY) {
        console.warn('[Email] RESEND_API_KEY not configured — skipping');
        return null;
    }
    try {
        const result = await resend.emails.send({
            from: EMAIL_FROM,
            to,
            subject,
            html,
            replyTo: EMAIL_REPLY_TO,
        });
        // The Resend SDK reports failures via `error` instead of throwing —
        // ignoring it made rejected sends look successful in the logs.
        if (result?.error) {
            console.error('[Email] Resend rejected send to', maskEmail(to), '|', result.error.message || JSON.stringify(result.error));
            return null;
        }
        console.log('[Email] Sent to:', maskEmail(to), '| id:', result?.data?.id || 'n/a');
        return result;
    } catch (error: any) {
        console.error('[Email] Failed:', error?.message || error);
        return null;
    }
}

/**
 * Ghana-specific phone formatter for Moolre SMS API.
 * Accepts 0XX / 233XX / +233XX and returns E.164 (+233...).
 */
function formatPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '233' + cleaned.substring(1);
    if (cleaned.length === 9) cleaned = '233' + cleaned;
    return '+' + cleaned;
}

export async function sendSMS({ to, message }: { to: string; message: string }) {
    // Official Moolre SMS auth is X-API-VASKEY only (payment USER/PUBKEY must not
    // be mixed in — that returns AIN01 Authentication Error).
    // Coolify sometimes stores JWT env values wrapped in quotes; strip them.
    const smsVasKey = (process.env.MOOLRE_SMS_API_KEY || '')
        .trim()
        .replace(/^['"]+|['"]+$/g, '');
    if (!smsVasKey) {
        console.warn('[SMS] Missing MOOLRE_SMS_API_KEY. Skipping.');
        return { success: false, message: 'SMS credentials missing', data: null };
    }

    const recipient = formatPhoneNumber(to);
    const senderId = (process.env.MOOLRE_SMS_SENDER_ID || 'Hy-Stepper').trim();

    try {
        console.log(`[SMS] Sending to ${maskPhone(recipient)} via ${senderId}`);
        const response = await fetch('https://api.moolre.com/open/sms/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-VASKEY': smsVasKey,
            },
            body: JSON.stringify({
                type: 1,
                senderid: senderId,
                messages: [{ recipient, message }],
            }),
        });

        const text = await response.text();
        let result: any = null;
        try {
            result = JSON.parse(text);
        } catch {
            console.error('[SMS] Non-JSON response:', text.slice(0, 200));
            return { success: false, status: 0, error: text.slice(0, 200) };
        }

        console.log('[SMS] Result:', result.status === 1 ? 'Success' : 'Failed', '| code:', result.code);
        if (result.status !== 1) {
            console.log('[SMS] Full response:', JSON.stringify(result).slice(0, 500));
        }
        return { success: result.status === 1, ...result };
    } catch (error: any) {
        console.error('[SMS] Error:', error?.message || error);
        return { success: false, message: error?.message || 'SMS send failed', data: null };
    }
}

// ---------------------------------------------------------------------------
// Order confirmation — email (customer + admin) + SMS
// ---------------------------------------------------------------------------

export async function sendOrderConfirmation(order: any) {
    if (!order) return;
    const { id, email, total, created_at, order_number, metadata } = order;

    // Idempotency: if another path already sent the confirmation for this
    // order, short-circuit.
    const proceed = await claimConfirmationSend(id);
    if (!proceed) return;

    const name = resolveCustomerName(order);
    const phone = resolveCustomerPhone(order);

    const orderRef = order_number || id;
    const trackingNumber = metadata?.tracking_number || '';
    const trackingUrl = trackingUrlFor(orderRef);

    // Partial-payment awareness ("Pay Item Cost Only").
    const payableNow = Number(metadata?.payable_now);
    const deliveryDue = Number(metadata?.delivery_fee_due);
    const isPartial =
        Number.isFinite(payableNow) && payableNow > 0 &&
        Number.isFinite(deliveryDue) && deliveryDue > 0 &&
        Math.abs(payableNow + deliveryDue - Number(total)) < 0.01;

    console.log(
        `[Notification] Order confirmation #${orderRef} | Phone: ${phone ? maskPhone(phone) : 'missing'} | Email: ${email ? maskEmail(email) : 'missing'} | Tracking: ${trackingNumber || 'none'}`
    );

    // Optional preorder/shipping notes attached to individual items.
    let shippingNotes: string[] = [];
    try {
        const { data: items } = await supabase
            .from('order_items')
            .select('product_name, metadata')
            .eq('order_id', id);
        if (items) {
            for (const item of items) {
                const preorder = (item as any).metadata?.preorder_shipping;
                if (preorder) shippingNotes.push(`${item.product_name}: ${preorder}`);
            }
        }
    } catch {
        /* non-critical */
    }

    // -----------------------------------------------------------------------
    // 1. Customer email
    // -----------------------------------------------------------------------
    if (email) {
        const totalRow = isPartial
            ? `${emailInfoRow('Paid now', `<span style="color:${BRAND.color};font-weight:700;">GH₵${Number(payableNow).toFixed(2)}</span>`)}
               ${emailInfoRow('Due on delivery', `GH₵${Number(deliveryDue).toFixed(2)}`)}`
            : emailInfoRow('Total paid', `<span style="color:${BRAND.color};font-weight:700;">GH₵${Number(total).toFixed(2)}</span>`);

        const customerHtml = emailLayout(`
<div style="text-align:center;margin-bottom:24px;">
  <div style="width:64px;height:64px;background-color:${BRAND.colorLight};border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">&#10003;</div>
  <h2 style="margin:0 0 4px;color:#111827;font-size:24px;">Order Confirmed!</h2>
  <p style="margin:0;color:#6b7280;font-size:15px;">Thank you for your purchase, ${escapeHtml(name)}.</p>
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf8f3;border-radius:12px;overflow:hidden;margin:20px 0;">
  ${emailInfoRow('Order Number', `#${escapeHtml(String(orderRef))}`)}
  ${emailInfoRow('Order Date', new Date(created_at || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}
  ${trackingNumber ? emailInfoRow('Tracking', escapeHtml(String(trackingNumber))) : ''}
  ${totalRow}
</table>

${emailShippingNotes(shippingNotes)}

<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0;">We're preparing your order. You'll receive updates as it moves through processing, packaging, and delivery.</p>

${emailButton('Track Your Order', trackingUrl)}

<p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">Or copy this link: <a href="${trackingUrl}" style="color:${BRAND.color};">${trackingUrl}</a></p>
`, `Your order #${orderRef} is confirmed!`);

        await sendEmail({
            to: email,
            subject: `Order Confirmed! #${orderRef}`,
            html: customerHtml,
        });
    }

    // -----------------------------------------------------------------------
    // 2. Admin email
    // -----------------------------------------------------------------------
    const adminHtml = emailLayout(`
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;">&#128230; New Order Received</h2>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf8f3;border-radius:12px;overflow:hidden;margin:16px 0;">
  ${emailInfoRow('Order', `#${escapeHtml(String(orderRef))}`)}
  ${emailInfoRow('Customer', escapeHtml(name))}
  ${email ? emailInfoRow('Email', escapeHtml(email)) : ''}
  ${phone ? emailInfoRow('Phone', escapeHtml(phone)) : ''}
  ${isPartial
            ? emailInfoRow('Paid now', `GH₵${Number(payableNow).toFixed(2)} (GH₵${Number(deliveryDue).toFixed(2)} due on delivery)`)
            : emailInfoRow('Total', `GH₵${Number(total).toFixed(2)}`)}
</table>

${emailShippingNotes(shippingNotes)}

${emailButton('View Order in Admin', `${BRAND.url}/admin/orders/${id}`)}
`, `New order #${orderRef} from ${name}`);

    await sendEmail({
        to: ADMIN_EMAIL,
        subject: `New Order #${orderRef}`,
        html: adminHtml,
    });

    // -----------------------------------------------------------------------
    // 3. Customer SMS
    // -----------------------------------------------------------------------
    if (phone) {
        const shippingNotesSms = shippingNotes.length > 0 ? ` Note: ${shippingNotes.join('; ')}.` : '';
        const amountLine = isPartial
            ? ` Paid GH₵${Number(payableNow).toFixed(2)} online; GH₵${Number(deliveryDue).toFixed(2)} due on delivery.`
            : '';
        const smsMessage = trackingNumber
            ? `Hi ${name}, your ${BRAND.name} order #${orderRef} is confirmed!${amountLine} Tracking: ${trackingNumber}. Track: ${trackingUrl}${shippingNotesSms}`
            : `Hi ${name}, your ${BRAND.name} order #${orderRef} is confirmed!${amountLine} Track: ${trackingUrl}${shippingNotesSms}`;

        await sendSMS({ to: phone, message: smsMessage });
    }
}

// ---------------------------------------------------------------------------
// Order status update — email + SMS
// ---------------------------------------------------------------------------

export async function sendOrderStatusUpdate(order: any, newStatus: string) {
    if (!order || !newStatus) return;
    const { id, email, order_number, metadata } = order;

    const orderRef = order_number || id;
    const name = resolveCustomerName(order);
    const phone = resolveCustomerPhone(order);
    const trackingNumber = metadata?.tracking_number || '';
    const trackingUrl = trackingUrlFor(orderRef);

    // POS walk-in orders use the placeholder 'pos@store.local' as a required
    // email column filler. Don't send customer emails to that address — it's
    // not a real inbox.
    const deliverableEmail = email && email !== 'pos@store.local' ? email : '';

    console.log(
        `[Status Update] #${orderRef} -> ${newStatus} | Email: ${deliverableEmail ? maskEmail(deliverableEmail) : 'skip'} | Phone: ${phone ? maskPhone(phone) : 'skip'} | Tracking: ${trackingNumber || 'none'}`
    );

    const subject = `Order Update #${orderRef}`;
    let emailMessage = `Your order #${orderRef} status has been updated to ${newStatus}.`;
    let smsMessage = emailMessage;

    if (newStatus === 'shipped') {
        emailMessage = `Good news! Your order #${orderRef} has been shipped and is on its way.`;
        smsMessage = trackingNumber
            ? `Hi ${name}, order #${orderRef} has been shipped. Tracking: ${trackingNumber}. Track: ${trackingUrl}`
            : `Hi ${name}, order #${orderRef} has been shipped. Track: ${trackingUrl}`;
    } else if (newStatus === 'packaged') {
        // `packaged` isn't in the order_status enum, but POS / future code
        // might emit it. Keep a distinct copy so customers aren't told their
        // order has shipped when it's only been boxed.
        emailMessage = `Your order #${orderRef} has been packaged and is ready for dispatch.`;
        smsMessage = trackingNumber
            ? `Hi ${name}, order #${orderRef} has been packaged and is ready for dispatch. Tracking: ${trackingNumber}. Track: ${trackingUrl}`
            : `Hi ${name}, order #${orderRef} has been packaged and is ready for dispatch. Track: ${trackingUrl}`;
    } else if (newStatus === 'dispatched_to_rider' || newStatus === 'out_for_delivery') {
        emailMessage = `Your order #${orderRef} is with the rider and on its way to you.`;
        smsMessage = trackingNumber
            ? `Hi ${name}, order #${orderRef} is with the rider for delivery. Tracking: ${trackingNumber}. Track: ${trackingUrl}`
            : `Hi ${name}, order #${orderRef} is with the rider for delivery. Track: ${trackingUrl}`;
    } else if (newStatus === 'delivered') {
        emailMessage = `Your order #${orderRef} has been delivered. Enjoy! When you have a moment, we'd love your feedback — tap the button below to leave a review.`;
        smsMessage = `Hi ${name}, your order #${orderRef} has been delivered. Thanks for shopping with ${BRAND.name}!`;
    } else if (newStatus === 'processing') {
        emailMessage = `We're processing your order #${orderRef} now.`;
        smsMessage = trackingNumber
            ? `Hi ${name}, order #${orderRef} is being processed. Tracking: ${trackingNumber}. Track: ${trackingUrl}`
            : `Hi ${name}, order #${orderRef} is being processed. Track: ${trackingUrl}`;
    } else if (newStatus === 'cancelled') {
        emailMessage = `Your order #${orderRef} has been cancelled.`;
        smsMessage = `Hi ${name}, order #${orderRef} was cancelled. Contact us if this was a mistake.`;
    } else if (newStatus === 'returned') {
        const m = metadata || {};
        const reason = (m as { return_note?: string; rider_return_note?: string }).return_note
            || (m as { return_note?: string; rider_return_note?: string }).rider_return_note;
        emailMessage = reason
            ? `We could not complete delivery for order #${orderRef}. ${reason} Our team will follow up with you.`
            : `We could not complete delivery for order #${orderRef}. Our team will follow up with you about next steps.`;
        smsMessage = reason
            ? `Hi ${name}, delivery for #${orderRef} was unsuccessful (${reason}). ${BRAND.name} will contact you.`
            : `Hi ${name}, delivery for #${orderRef} was unsuccessful. ${BRAND.name} will contact you about next steps.`;
    } else {
        smsMessage = `Hi ${name}, order #${orderRef} status: ${newStatus}. Track: ${trackingUrl}`;
    }

    const statusConfig: Record<string, { icon: string; color: string; bg: string }> = {
        processing: { icon: '&#9881;', color: '#2563eb', bg: '#eff6ff' },
        packaged: { icon: '&#128230;', color: '#047857', bg: '#ecfdf5' },
        shipped: { icon: '&#128666;', color: '#047857', bg: '#ecfdf5' },
        dispatched_to_rider: { icon: '&#128101;', color: '#4f46e5', bg: '#eef2ff' },
        out_for_delivery: { icon: '&#128666;', color: '#4f46e5', bg: '#eef2ff' },
        delivered: { icon: '&#127881;', color: '#16a34a', bg: '#f0fdf4' },
        returned: { icon: '&#8617;', color: '#b45309', bg: '#fffbeb' },
        cancelled: { icon: '&#10060;', color: '#dc2626', bg: '#fef2f2' },
    };
    const sc = statusConfig[newStatus] || { icon: '&#128276;', color: '#6b7280', bg: '#f9fafb' };

    // Resolve the review URL once for the delivered status so SMS + email use
    // the same destination (single-product link when possible).
    const reviewUrl = newStatus === 'delivered'
        ? await resolveReviewUrl(id, String(orderRef))
        : '';
    if (newStatus === 'delivered') {
        smsMessage = `${smsMessage} Loved it? Leave a quick review: ${reviewUrl}`;
    }

    if (deliverableEmail) {
        try {
            await sendEmail({
                to: deliverableEmail,
                subject,
                html: emailLayout(`
<div style="text-align:center;margin-bottom:24px;">
  <div style="width:64px;height:64px;background-color:${sc.bg};border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">${sc.icon}</div>
  <h2 style="margin:0 0 4px;color:#111827;font-size:22px;">Order Update</h2>
  <p style="margin:0;color:#6b7280;font-size:14px;">Hi ${escapeHtml(name)}, here's an update on your order.</p>
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf8f3;border-radius:12px;overflow:hidden;margin:20px 0;">
  ${emailInfoRow('Order Number', `#${escapeHtml(String(orderRef))}`)}
  ${emailInfoRow('New Status', `<span style="display:inline-block;background-color:${sc.bg};color:${sc.color};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;text-transform:uppercase;">${escapeHtml(newStatus)}</span>`)}
  ${trackingNumber ? emailInfoRow('Tracking Number', escapeHtml(String(trackingNumber))) : ''}
</table>

<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0;">${escapeHtml(emailMessage)}</p>

${newStatus === 'delivered'
    ? emailButton('Leave a Review', reviewUrl)
    : emailButton('Track Your Order', trackingUrl)}
`, `Your order #${orderRef} is now ${newStatus}`),
            });
            console.log(`[Status Update] Email sent for #${orderRef}`);
        } catch (err: any) {
            console.error(`[Status Update] Email failed for #${orderRef}:`, err?.message || err);
        }
    }

    if (phone) {
        const result = await sendSMS({ to: phone, message: smsMessage });
        console.log(
            `[Status Update] SMS result for #${orderRef}: ${result?.success ? 'SUCCESS' : 'FAILED'}`
        );
    }
}

// ---------------------------------------------------------------------------
// Payment link email / SMS (admin-initiated)
// ---------------------------------------------------------------------------

export async function sendPaymentLink(order: any) {
    const { id, email, total, order_number, metadata } = order;

    const orderRef = order_number || id;
    const name = resolveCustomerName(order);
    const phone = resolveCustomerPhone(order);
    const paymentUrl = `${BRAND.url}/pay/${id}`;
    const payableNow = Number(metadata?.payable_now);
    const amountDue =
        Number.isFinite(payableNow) && payableNow > 0 ? payableNow : Number(total);

    console.log(`[Notification] Payment link for #${orderRef} | Phone: ${phone ? 'yes' : 'no'}`);

    if (email) {
        await sendEmail({
            to: email,
            subject: `Complete Your Order #${orderRef}`,
            html: emailLayout(`
<div style="text-align:center;margin-bottom:24px;">
  <div style="width:64px;height:64px;background-color:#fef3c7;border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">&#128179;</div>
  <h2 style="margin:0 0 4px;color:#111827;font-size:22px;">Complete Your Order</h2>
  <p style="margin:0;color:#6b7280;font-size:14px;">Hi ${escapeHtml(name)}, your order is waiting for payment.</p>
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf8f3;border-radius:12px;overflow:hidden;margin:20px 0;">
  ${emailInfoRow('Order Number', `#${escapeHtml(String(orderRef))}`)}
  ${emailInfoRow('Amount Due', `<span style="color:${BRAND.color};font-size:18px;font-weight:700;">GH₵${amountDue.toFixed(2)}</span>`)}
</table>

<p style="color:#374151;font-size:14px;line-height:1.6;margin:16px 0;">Click the button below to complete payment securely. The link stays active until the order is paid or cancelled.</p>

${emailButton('Pay Now — GH₵' + amountDue.toFixed(2), paymentUrl, '#d97706')}

<p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">Or copy: <a href="${paymentUrl}" style="color:${BRAND.color};">${paymentUrl}</a></p>
`, `Complete payment for order #${orderRef}`),
        });
    }

    if (phone) {
        await sendSMS({
            to: phone,
            message: `Hi ${name}, complete order #${orderRef} (GH₵${amountDue.toFixed(2)}) here: ${paymentUrl}`,
        });
    }
}

// ---------------------------------------------------------------------------
// Welcome (new signup)
// ---------------------------------------------------------------------------

export async function sendWelcomeMessage(user: { email: string; firstName: string; phone?: string }) {
    const { email, firstName, phone } = user;
    if (!email) return;

    await sendEmail({
        to: email,
        subject: `Welcome to ${BRAND.name}!`,
        html: emailLayout(`
<div style="text-align:center;margin-bottom:24px;">
  <div style="width:64px;height:64px;background-color:${BRAND.colorLight};border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">&#128075;</div>
  <h2 style="margin:0 0 4px;color:#111827;font-size:24px;">Welcome, ${escapeHtml(firstName)}!</h2>
  <p style="margin:0;color:#6b7280;font-size:15px;">We're thrilled to have you at ${BRAND.name}.</p>
</div>

<p style="color:#374151;font-size:14px;line-height:1.7;margin:16px 0;">Thanks for joining us. Explore our curated collection and start earning Sleek Points on every order.</p>

${emailButton('Start Shopping', `${BRAND.url}/shop`)}
`, `Welcome to ${BRAND.name}, ${firstName}!`),
    });

    // Welcome SMS disabled by default — order-confirmation remains the single
    // transactional SMS. Uncomment to re-enable:
    // if (phone) {
    //     await sendSMS({ to: phone, message: `Welcome ${firstName}! Thanks for joining ${BRAND.name}.` });
    // }
    void phone;
}

// ---------------------------------------------------------------------------
// Contact form
// ---------------------------------------------------------------------------

export async function sendContactMessage(data: {
    name: string;
    email: string;
    subject: string;
    message: string;
}) {
    const { name, email, subject, message } = data;

    const safeName = escapeHtml(name);
    const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message);
    const safeEmail = escapeHtml(email);

    await sendEmail({
        to: email,
        subject: `We received your message: ${subject}`,
        html: emailLayout(`
<div style="text-align:center;margin-bottom:24px;">
  <div style="width:64px;height:64px;background-color:${BRAND.colorLight};border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">&#128172;</div>
  <h2 style="margin:0 0 4px;color:#111827;font-size:22px;">Message Received</h2>
  <p style="margin:0;color:#6b7280;font-size:14px;">We'll get back to you shortly.</p>
</div>

<p style="color:#374151;font-size:14px;line-height:1.7;margin:16px 0;">Hi ${safeName},</p>
<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px;">Thanks for contacting ${BRAND.name}. We've received your message about <strong>"${safeSubject}"</strong> and our team will respond as soon as possible.</p>

<div style="background-color:#faf8f3;border-left:4px solid ${BRAND.color};border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0;">
  <p style="color:#6b7280;font-size:12px;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px;">Your message</p>
  <p style="color:#374151;font-size:14px;margin:0;line-height:1.6;">${safeMessage}</p>
</div>

<p style="color:#6b7280;font-size:13px;margin:16px 0 0;">We typically respond within 24 hours.</p>
`, `Thanks for contacting us, ${safeName}`),
    });

    await sendEmail({
        to: ADMIN_EMAIL,
        subject: `Contact: ${subject}`,
        html: emailLayout(`
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;">&#128233; New Contact Message</h2>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf8f3;border-radius:12px;overflow:hidden;margin:16px 0;">
  ${emailInfoRow('From', safeName)}
  ${emailInfoRow('Email', `<a href="mailto:${safeEmail}" style="color:${BRAND.color};">${safeEmail}</a>`)}
  ${emailInfoRow('Subject', safeSubject)}
</table>

<div style="background-color:#faf8f3;border-left:4px solid ${BRAND.color};border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0;">
  <p style="color:#6b7280;font-size:12px;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px;">Message</p>
  <p style="color:#374151;font-size:14px;margin:0;line-height:1.6;">${safeMessage}</p>
</div>

${emailButton('Reply to ' + safeName, `mailto:${safeEmail}?subject=Re: ${encodeURIComponent(subject)}`)}
`, `New contact from ${safeName}: ${safeSubject}`),
    });
}

// ---------------------------------------------------------------------------
// POS admin alert — fires whenever the POS completes a sale (walk-in or
// delivery) so the store owner always gets an SMS notification, even when
// the customer didn't leave any contact details.
// ---------------------------------------------------------------------------

async function resolveAdminAlertPhone(): Promise<{ phone: string | null; source: string }> {
    const adminEnv = (process.env.ADMIN_PHONE || '').trim();
    if (adminEnv) return { phone: adminEnv, source: 'ADMIN_PHONE env' };

    const storeEnv = (process.env.STORE_PHONE || '').trim();
    if (storeEnv) return { phone: storeEnv, source: 'STORE_PHONE env' };

    try {
        const { data, error } = await supabaseAdmin
            .from('store_settings')
            .select('value')
            .eq('key', 'contact_phone')
            .maybeSingle();

        if (error) {
            console.warn('[POS Admin Alert] store_settings lookup failed:', error.message);
            return { phone: null, source: 'none' };
        }

        // store_settings.value is JSONB — Supabase parses it into a JS value.
        // It can come back as a plain string ("0276558163") or occasionally a
        // quoted string; strip leading/trailing quotes just in case.
        const raw = data?.value;
        const asString = typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw);
        const cleaned = asString.replace(/^"+|"+$/g, '').trim();
        return cleaned
            ? { phone: cleaned, source: 'store_settings.contact_phone' }
            : { phone: null, source: 'none' };
    } catch (err: any) {
        console.warn('[POS Admin Alert] store_settings fallback error:', err?.message || err);
        return { phone: null, source: 'none' };
    }
}

export async function sendPosAdminAlert(alert: {
    orderId: string;
    orderNumber: string;
    total: number;
    orderType: 'walk_in' | 'delivery';
    paymentMethod: string;
    customerName?: string;
    customerPhone?: string;
}) {
    const { phone: adminPhone, source } = await resolveAdminAlertPhone();
    const typeLabel = alert.orderType === 'delivery' ? 'Delivery' : 'Walk-in';
    const rawMethod = (alert.paymentMethod || 'cash').toString().toLowerCase();
    const isPayOnDelivery = rawMethod === 'pay_on_delivery';
    // Friendlier method label so the admin SMS doesn't read "via PAY_ON_DELIVERY".
    const payLabel = isPayOnDelivery
        ? 'PAY ON DELIVERY (UNPAID)'
        : rawMethod === 'momo' || rawMethod === 'mobile_money'
            ? 'MOMO'
            : rawMethod.toUpperCase();
    const customerLine = alert.customerName && alert.customerName !== 'Walk-in Customer'
        ? ` for ${alert.customerName}`
        : '';
    const phoneLine = alert.customerPhone ? ` (${alert.customerPhone})` : '';

    const message = `POS ${typeLabel} sale #${alert.orderNumber}: GH₵${Number(alert.total).toFixed(2)} via ${payLabel}${customerLine}${phoneLine}.`;

    console.log(
        `[POS Admin Alert] Order #${alert.orderNumber} | Admin phone: ${adminPhone ? maskPhone(adminPhone) : 'NONE'} (source: ${source})`
    );

    if (adminPhone) {
        const result = await sendSMS({ to: adminPhone, message });
        console.log(
            `[POS Admin Alert] SMS result for #${alert.orderNumber}: ${result?.success ? 'SUCCESS' : 'FAILED'}`
        );
    } else {
        console.warn(
            `[POS Admin Alert] No admin phone configured. Set ADMIN_PHONE (or STORE_PHONE, or store_settings.contact_phone).`
        );
    }

    // Also email the admin with a short branded summary so there's a written
    // paper-trail alongside the SMS.
    try {
        await sendEmail({
            to: ADMIN_EMAIL,
            subject: `POS ${typeLabel} Sale #${alert.orderNumber}`,
            html: emailLayout(`
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;">New POS ${typeLabel} Sale</h2>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf8f3;border-radius:12px;overflow:hidden;margin:16px 0;">
  ${emailInfoRow('Order', `#${escapeHtml(alert.orderNumber)}`)}
  ${emailInfoRow('Type', typeLabel)}
  ${emailInfoRow('Total', `<span style="color:${BRAND.color};font-weight:700;">GH₵${Number(alert.total).toFixed(2)}</span>`)}
  ${emailInfoRow('Payment', escapeHtml(payLabel))}
  ${alert.customerName ? emailInfoRow('Customer', escapeHtml(alert.customerName)) : ''}
  ${alert.customerPhone ? emailInfoRow('Phone', escapeHtml(alert.customerPhone)) : ''}
</table>

${emailButton('Open Order', `${BRAND.url}/admin/orders/${alert.orderId}`)}
`, `New POS ${typeLabel} sale #${alert.orderNumber}`),
        });
    } catch (err) {
        console.error('[Notification] POS admin email failed:', err);
    }
}
