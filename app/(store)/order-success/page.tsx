'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { trackPurchase } from '@/components/TrackingScripts';

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get('order');
  const paymentSuccessFlag = searchParams.get('payment_success') === 'true';
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showConfetti, setShowConfetti] = useState(true);

  const fetchOrder = async () => {
    if (!orderNumber) return null;
    const { data: orderData, error } = await supabase
      .from('orders')
      .select(`*, order_items (*)`)
      .eq('order_number', orderNumber)
      .single();
    if (error) throw error;
    return orderData;
  };

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!orderNumber) {
        setLoading(false);
        return;
      }

      try {
        let orderData = await fetchOrder();
        if (cancelled) return;

        // Auto-reconcile: if we returned from Moolre but the async webhook hasn't
        // flipped the order to paid yet, query Moolre directly and update the order.
        const needsReconcile =
          paymentSuccessFlag &&
          orderData &&
          orderData.payment_method === 'moolre' &&
          orderData.payment_status !== 'paid' &&
          orderData.payment_status !== 'refunded';

        if (needsReconcile) {
          // Mirrors standardecom: give the webhook ~3s to land, refetch,
          // then fall through to /verify which asks Moolre directly.
          await new Promise((resolve) => setTimeout(resolve, 3000));
          if (cancelled) return;

          try {
            const refreshed = await fetchOrder();
            if (refreshed?.payment_status === 'paid') {
              orderData = refreshed;
            } else {
              try {
                const res = await fetch('/api/payment/moolre/verify', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ orderNumber }),
                });
                const result = await res.json().catch(() => ({}));
                if (result?.success && result?.payment_status === 'paid') {
                  const updated = await fetchOrder();
                  if (updated) orderData = updated;
                } else {
                  orderData = await fetchOrder();
                }
              } catch (verifyErr) {
                console.warn('Verify failed (non-blocking):', verifyErr);
              }
            }
          } catch (refetchErr) {
            console.warn('Refetch during verify failed:', refetchErr);
          }
        }

        if (!cancelled) setOrder(orderData);
      } catch (err) {
        console.error('Error fetching order:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [orderNumber, paymentSuccessFlag]);

  // Fire a GA4 / Meta Pixel purchase conversion once per order (guarded via
  // sessionStorage so refreshes don't double-count).
  useEffect(() => {
    if (!order?.order_number) return;
    if ((order.payment_status || '').toLowerCase() !== 'paid') return;
    const guardKey = `hy_purchase_tracked_${order.order_number}`;
    try {
      if (sessionStorage.getItem(guardKey)) return;
      sessionStorage.setItem(guardKey, '1');
    } catch { /* ignore */ }
    trackPurchase({
      orderNumber: order.order_number,
      total: Number(order.total) || 0,
      currency: order.currency || 'GHS',
      items: (order.order_items || []).map((it: any) => ({
        name: it.product_name,
        quantity: it.quantity,
        price: Number(it.unit_price) || 0,
      })),
    });
  }, [order]);

  // Light background poll while the order is still pending so the page
  // flips to "Payment received" automatically once admin/webhook updates
  // it. Stops polling as soon as the order moves out of pending.
  useEffect(() => {
    if (!order || !orderNumber) return;
    const status = (order.payment_status || 'pending').toLowerCase();
    if (status !== 'pending') return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from('orders')
          .select('*, order_items(*)')
          .eq('order_number', orderNumber)
          .single();
        if (cancelled || !data) return;
        if ((data.payment_status || '').toLowerCase() !== 'pending') {
          setOrder(data);
        }
      } catch {
        // ignore — try again next tick
      }
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [order, orderNumber]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <i className="ri-loader-4-line text-4xl text-gold-700 animate-spin mb-4 block"></i>
          <p className="text-gray-500">Loading order details...</p>
        </div>
      </div>
    );
  }

  // Use a fallback or nice error if order not found
  if (!order) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <i className="ri-error-warning-line text-4xl text-red-500 mb-4 block"></i>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Order Not Found</h1>
          <p className="text-gray-600 mb-6">We couldn't locate the order details.</p>
          <Link href="/shop" className="text-gold-700 font-semibold hover:underline">
            Return to Shop
          </Link>
        </div>
      </main>
    );
  }

  const orderDate = new Date(order.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const estimatedDelivery = new Date(new Date(order.created_at).getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  // Sleek Points: 5 points per item (matches the DB trigger that credits
  // them when the order moves to 'delivered'). Min redemption is 15 pts.
  const totalItemsForPoints = (order.order_items || []).reduce(
    (sum: number, item: any) => sum + (Number(item.quantity) || 0),
    0
  );
  const pointsEarned = totalItemsForPoints * 5;

  const shippingAddr = order.shipping_address || {};
  const recipientName = [shippingAddr.firstName, shippingAddr.lastName].filter(Boolean).join(' ').trim() || 'Customer';
  const firstName = recipientName.split(' ')[0] || 'there';
  const addressLines = [
    shippingAddr.address,
    [shippingAddr.city, shippingAddr.region].filter(Boolean).join(', '),
    shippingAddr.postalCode,
  ].filter(Boolean);

  const isPosPlaceholderEmail =
    typeof order.email === 'string' && order.email.toLowerCase() === 'pos@store.local';
  const customerEmail = isPosPlaceholderEmail ? '' : order.email || '';
  const customerPhone = order.phone || shippingAddr.phone || '';

  const paymentState = (order.payment_status || 'pending').toLowerCase();
  const isPaid = paymentState === 'paid';
  const isFailed = paymentState === 'failed';
  const isRefunded = paymentState === 'refunded' || paymentState === 'partially_refunded';
  const isPending = !isPaid && !isFailed && !isRefunded;

  // POS orders are settled in-person — the customer doesn't need (or want)
  // a payment-status banner or a "Paid" milestone in the delivery timeline.
  // Detect by order_number prefix or the metadata flag we set in the POS UI.
  const isPosOrder =
    String(order.order_number || '').toUpperCase().startsWith('POS-') ||
    order.metadata?.is_pos === true ||
    order.metadata?.pos === true;

  // Visual treatment that adapts to the actual payment outcome instead of
  // unconditionally celebrating. "PAYMENT RECEIVED" with confetti for an
  // unpaid POS order is misleading — that's exactly the bug we're fixing.
  const statusBadge = (() => {
    if (isPaid) {
      return {
        label: 'Payment received',
        className: 'bg-emerald-50 border-emerald-200 text-emerald-700',
        dotClass: 'bg-emerald-500 animate-pulse',
      };
    }
    if (isPending) {
      return {
        label: 'Awaiting payment',
        className: 'bg-amber-50 border-amber-200 text-amber-700',
        dotClass: 'bg-amber-500 animate-pulse',
      };
    }
    if (isFailed) {
      return {
        label: 'Payment failed',
        className: 'bg-red-50 border-red-200 text-red-700',
        dotClass: 'bg-red-500',
      };
    }
    return {
      label: 'Order refunded',
      className: 'bg-gray-100 border-gray-200 text-gray-700',
      dotClass: 'bg-gray-500',
    };
  })();

  const heroIcon = (() => {
    if (isPaid) return { icon: 'ri-check-line', tone: 'from-gold-500 to-amber-600', shadow: 'shadow-gold-200' };
    if (isFailed) return { icon: 'ri-close-line', tone: 'from-red-500 to-rose-600', shadow: 'shadow-red-200' };
    if (isRefunded) return { icon: 'ri-arrow-go-back-line', tone: 'from-gray-500 to-gray-700', shadow: 'shadow-gray-200' };
    return { icon: 'ri-time-line', tone: 'from-amber-500 to-orange-500', shadow: 'shadow-amber-200' };
  })();

  const headline = (() => {
    if (isPaid) return `Thank you, ${firstName}.`;
    if (isFailed) return `Payment didn't go through, ${firstName}.`;
    if (isRefunded) return `Order refunded, ${firstName}.`;
    return `Order received, ${firstName}.`;
  })();

  const subline = (() => {
    if (isPaid) {
      const channels = [
        customerPhone ? `by SMS to ${customerPhone}` : '',
        customerEmail ? `by email to ${customerEmail}` : '',
      ].filter(Boolean);
      return channels.length > 0
        ? `Your order ${order.order_number} is confirmed. A receipt is on its way ${channels.join(' and ')}.`
        : `Your order ${order.order_number} is confirmed.`;
    }
    if (isPending) {
      return `Your order ${order.order_number} has been recorded. We're awaiting payment confirmation — once it lands you'll see this update automatically.`;
    }
    if (isFailed) {
      return `We weren't able to confirm payment for ${order.order_number}. No worries — try again or contact us and we'll sort it out.`;
    }
    return `Your order ${order.order_number} has been refunded.`;
  })();

  const showConfettiNow = showConfetti && isPaid;

  // Steps reflect both fulfilment status and payment state so the timeline
  // doesn't claim the order is "Confirmed" when payment is still pending.
  const fulfilmentStatus = (order.status || '').toLowerCase();
  const fulfilmentRank: Record<string, number> = {
    pending: 0,
    confirmed: 1,
    processing: 2,
    packaged: 2,
    dispatched_to_rider: 3,
    out_for_delivery: 3,
    shipped: 3,
    delivered: 4,
  };
  // POS orders skip the "Paid" milestone, so we collapse the rank table
  // by one slot to keep the timeline highlighting accurate.
  const posFulfilmentRank: Record<string, number> = {
    pending: 0,
    confirmed: 0,
    processing: 1,
    packaged: 1,
    dispatched_to_rider: 2,
    out_for_delivery: 2,
    shipped: 2,
    delivered: 3,
  };
  const currentStage = isPosOrder
    ? (posFulfilmentRank[fulfilmentStatus] ?? 0)
    : (isPending ? 0 : (fulfilmentRank[fulfilmentStatus] ?? 1));
  const baseSteps = [
    { key: 'paid', label: isPaid ? 'Paid' : 'Payment', icon: isPaid ? 'ri-checkbox-circle-line' : 'ri-bank-card-line' },
    { key: 'processing', label: 'Processing', icon: 'ri-loader-4-line' },
    { key: 'shipped', label: 'Shipped', icon: 'ri-truck-line' },
    { key: 'delivered', label: 'Delivered', icon: 'ri-home-smile-2-line' },
  ];
  const visibleSteps = isPosOrder ? baseSteps.filter((s) => s.key !== 'paid') : baseSteps;
  const steps = visibleSteps.map((s, idx) => ({
    ...s,
    done: idx < currentStage,
    current: idx === currentStage,
  }));
  const progressPct = `${Math.min(100, (currentStage / Math.max(1, steps.length - 1)) * 100)}%`;

  return (
    <main className="min-h-screen bg-[#fafaf7]">
      {showConfettiNow && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {[...Array(36)].map((_, i) => (
            <div
              key={i}
              className="absolute animate-fall"
              style={{
                left: `${Math.random() * 100}%`,
                top: `-${Math.random() * 20}%`,
                animationDelay: `${Math.random() * 3}s`,
                animationDuration: `${3 + Math.random() * 2}s`
              }}
            >
              <i className={`ri-${['heart', 'star', 'sparkling'][Math.floor(Math.random() * 3)]}-fill text-${['yellow', 'amber', 'orange'][Math.floor(Math.random() * 3)]}-400 text-lg opacity-80`}></i>
            </div>
          ))}
        </div>
      )}

      <section className="relative overflow-hidden">
        <div className={`absolute inset-x-0 top-0 h-72 pointer-events-none ${
          isPaid
            ? 'bg-gradient-to-b from-gold-50 via-amber-50/40 to-transparent'
            : isFailed
            ? 'bg-gradient-to-b from-red-50 via-rose-50/40 to-transparent'
            : isRefunded
            ? 'bg-gradient-to-b from-gray-100 via-gray-50/40 to-transparent'
            : 'bg-gradient-to-b from-amber-50 via-orange-50/40 to-transparent'
        }`} />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-14 pb-10">
          <div className="text-center">
            {!isPosOrder && (
              <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs font-semibold tracking-wide uppercase mb-5 ${statusBadge.className}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dotClass}`} />
                {statusBadge.label}
              </div>
            )}
            <div className="relative w-20 h-20 mx-auto mb-5">
              {isPaid && <div className="absolute inset-0 rounded-full bg-gold-100 animate-ping opacity-60" />}
              <div className={`relative w-20 h-20 rounded-full bg-gradient-to-br ${heroIcon.tone} flex items-center justify-center shadow-lg ${heroIcon.shadow}`}>
                <i className={`${heroIcon.icon} text-white text-4xl font-bold`} />
              </div>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3 tracking-tight">
              {headline}
            </h1>
            <p className="text-base sm:text-lg text-gray-600 max-w-xl mx-auto">
              {subline}
            </p>
            {isPending && !isPosOrder && (
              <div className="mt-6 inline-flex items-start gap-3 max-w-xl text-left bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-4 py-3">
                <i className="ri-information-line text-xl mt-0.5" />
                <p className="text-sm leading-relaxed">
                  This page will refresh automatically once payment is confirmed. If you've already paid in cash or in-store, our team will mark this order as paid shortly.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-20">
        <div className="bg-white border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-sm mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-6">
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Order</p>
                <p className="font-semibold text-gray-900">{order.order_number}</p>
              </div>
              <div className="w-px h-10 bg-gray-200" />
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Placed</p>
                <p className="font-semibold text-gray-900">{orderDate}</p>
              </div>
              <div className="w-px h-10 bg-gray-200 hidden sm:block" />
              <div className="hidden sm:block">
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Est. delivery</p>
                <p className="font-semibold text-gold-700">{estimatedDelivery}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Link
                href="/account?tab=orders"
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-gray-900 hover:bg-black text-white text-sm font-semibold transition-colors"
              >
                <i className="ri-file-list-3-line mr-1.5" />
                View order
              </Link>
              <Link
                href="/shop"
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-full border border-gray-300 hover:border-gray-900 hover:text-gray-900 text-gray-700 text-sm font-semibold transition-colors"
              >
                Keep shopping
              </Link>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Order progress</h2>
            <span className="text-xs text-gray-500">Real-time</span>
          </div>
          <div className="relative">
            <div className="absolute top-5 left-0 right-0 h-0.5 bg-gray-200" />
            <div
              className="absolute top-5 left-0 h-0.5 bg-gradient-to-r from-gold-500 to-amber-500 transition-all"
              style={{ width: progressPct }}
            />
            <div
              className="relative grid gap-2"
              style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
            >
              {steps.map((step) => (
                <div key={step.key} className="flex flex-col items-center text-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                      step.done
                        ? 'bg-gradient-to-br from-gold-500 to-amber-600 border-transparent text-white shadow-md shadow-gold-200'
                        : step.current
                        ? 'bg-white border-gold-500 text-gold-600'
                        : 'bg-white border-gray-200 text-gray-300'
                    }`}
                  >
                    <i className={`${step.icon} text-lg ${step.current && step.key === 'processing' ? 'animate-spin-slow' : ''}`} />
                  </div>
                  <p className={`mt-2 text-xs font-semibold ${step.done || step.current ? 'text-gray-900' : 'text-gray-400'}`}>
                    {step.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 bg-white border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-gray-900">Your items</h2>
              <span className="text-sm text-gray-500">{order.order_items.length} item{order.order_items.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {order.order_items.map((item: any) => (
                <div key={item.id} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gray-50 rounded-xl overflow-hidden flex-shrink-0 border border-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.metadata?.image || '/placeholder-product.png'}
                      alt={item.product_name}
                      className="w-full h-full object-cover object-center"
                      loading="lazy"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{item.product_name}</p>
                    {(() => {
                      const meta: any = item.metadata || {};
                      const variantParts = (item.variant_name || '')
                        .split('/')
                        .map((part: string) => part.trim())
                        .filter(Boolean);
                      const sizeLabel = (meta.size || variantParts[0] || '').toString().trim();
                      const colorLabel = (meta.color || variantParts[1] || '').toString().trim();
                      return (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-gray-500">
                          {sizeLabel && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-800 font-semibold">
                              Size {sizeLabel}
                            </span>
                          )}
                          {colorLabel && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 border border-purple-200 text-purple-800 font-semibold">
                              {colorLabel}
                            </span>
                          )}
                          {!sizeLabel && !colorLabel && item.variant_name && (
                            <>
                              <span>{item.variant_name}</span>
                              <span className="w-1 h-1 rounded-full bg-gray-300" />
                            </>
                          )}
                          <span>Qty {item.quantity}</span>
                        </div>
                      );
                    })()}
                  </div>
                  <p className="font-semibold text-gray-900 text-right whitespace-nowrap">
                    GH₵{(item.unit_price * item.quantity).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 mt-6 pt-5 space-y-2">
              {(() => {
                const payableNow = Number(order.metadata?.payable_now);
                const deliveryDue = Number(order.metadata?.delivery_fee_due);
                const isPartial =
                  Number.isFinite(payableNow) &&
                  payableNow > 0 &&
                  Number.isFinite(deliveryDue) &&
                  deliveryDue > 0 &&
                  Math.abs(payableNow + deliveryDue - Number(order.total)) < 0.01;

                return (
                  <>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Subtotal</span>
                      <span>GH₵{order.subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Shipping</span>
                      <span>GH₵{order.shipping_total.toFixed(2)}</span>
                    </div>
                    {isPartial ? (
                      <>
                        <div className="flex justify-between pt-3 mt-2 border-t border-gray-100">
                          <span className="text-base font-bold text-gray-900">
                            {isPaid ? 'Paid now' : 'To pay now'}
                          </span>
                          <span className="text-lg font-bold text-gold-700">
                            GH₵{payableNow.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Due on delivery</span>
                          <span className="font-semibold text-amber-700">
                            GH₵{deliveryDue.toFixed(2)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between pt-3 mt-2 border-t border-gray-100">
                        <span className="text-base font-bold text-gray-900">
                          {isPaid ? 'Total paid' : isRefunded ? 'Order total' : 'Total due'}
                        </span>
                        <span className={`text-lg font-bold ${isPaid ? 'text-gold-700' : isRefunded ? 'text-gray-700' : 'text-amber-700'}`}>
                          GH₵{order.total.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900 mb-5">Delivery to</h2>
              <div className="space-y-4 text-sm">
                <div>
                  <p className="font-semibold text-gray-900">{recipientName}</p>
                  {addressLines.map((line, i) => (
                    <p key={i} className="text-gray-600">{line}</p>
                  ))}
                </div>
                {order.phone && (
                  <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                    <i className="ri-phone-line text-gray-400" />
                    <span className="text-gray-700">{order.phone}</span>
                  </div>
                )}
                {customerEmail && (
                  <div className="flex items-center gap-2">
                    <i className="ri-mail-line text-gray-400" />
                    <span className="text-gray-700 truncate">{customerEmail}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900 mb-5">What happens next</h2>
              <ol className="relative space-y-5">
                <div className="absolute left-[15px] top-6 bottom-6 w-px bg-gray-100" />
                {isPending && (
                  <li className="relative flex gap-4">
                    <div className="relative w-8 h-8 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
                      <i className="ri-bank-card-line text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Payment confirmation</p>
                      <p className="text-xs text-gray-500 mt-0.5">We'll mark this order as paid as soon as payment lands.</p>
                    </div>
                  </li>
                )}
                {(customerEmail || customerPhone) && isPaid && (
                  <li className="relative flex gap-4">
                    <div className="relative w-8 h-8 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center flex-shrink-0">
                      <i className="ri-mail-send-line text-gold-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Order receipt</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Sent to {[customerPhone, customerEmail].filter(Boolean).join(' and ')}
                      </p>
                    </div>
                  </li>
                )}
                {!isFailed && !isRefunded && (
                  <>
                    <li className="relative flex gap-4">
                      <div className="relative w-8 h-8 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center flex-shrink-0">
                        <i className="ri-box-3-line text-gold-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">We pack with care</p>
                        <p className="text-xs text-gray-500 mt-0.5">Dispatched within 24 hours</p>
                      </div>
                    </li>
                    <li className="relative flex gap-4">
                      <div className="relative w-8 h-8 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center flex-shrink-0">
                        <i className="ri-truck-line text-gold-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Live tracking</p>
                        <p className="text-xs text-gray-500 mt-0.5">Updates via {customerEmail ? 'email & ' : ''}SMS</p>
                      </div>
                    </li>
                  </>
                )}
                {isFailed && (
                  <li className="relative flex gap-4">
                    <div className="relative w-8 h-8 rounded-full bg-red-50 border border-red-200 flex items-center justify-center flex-shrink-0">
                      <i className="ri-customer-service-2-line text-red-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">We're here to help</p>
                      <p className="text-xs text-gray-500 mt-0.5">Try checkout again or contact us so we can complete your order.</p>
                    </div>
                  </li>
                )}
              </ol>
            </div>
          </div>
        </div>

        {isPaid && pointsEarned > 0 && (() => {
          const fulfilment = (order.status || '').toLowerCase();
          const alreadyDelivered = fulfilment === 'delivered';
          const isGuestOrder = !order.user_id;
          const headline = alreadyDelivered
            ? `You earned ${pointsEarned} Sleek Points`
            : `You'll earn ${pointsEarned} Sleek Points`;
          const sub = alreadyDelivered
            ? isGuestOrder
              ? 'Create an account to claim them and redeem on your next order (15 pts minimum).'
              : 'Already added to your account — redeem on your next order (15 pts minimum).'
            : isGuestOrder
              ? "We'll add them to your account once your order is delivered. Sign up now so you don't miss out."
              : "We'll add them to your account once your order is delivered. Redeem any time you have 15+ points.";
          const ctaLabel = isGuestOrder ? 'Create account' : 'View my account';
          const ctaHref = isGuestOrder ? '/auth/signup' : '/account?tab=orders';

          return (
            <div className="mt-6 relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-gray-900 to-gold-900 p-6 sm:p-8 text-white">
              <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-gold-500/20 blur-3xl" />
              <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gold-400 to-amber-500 flex items-center justify-center flex-shrink-0">
                    <i className="ri-sparkling-2-fill text-white text-xl" />
                  </div>
                  <div>
                    <p className="font-bold text-lg">{headline}</p>
                    <p className="text-sm text-white/70">{sub}</p>
                  </div>
                </div>
                <Link
                  href={ctaHref}
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-white text-gray-900 text-sm font-semibold hover:bg-gold-50 transition-colors whitespace-nowrap"
                >
                  {ctaLabel}
                  <i className="ri-arrow-right-line ml-1.5" />
                </Link>
              </div>
            </div>
          );
        })()}

        <div className="mt-10 text-center">
          <p className="text-sm text-gray-500 mb-3">Need a hand with your order?</p>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
            <Link href="/contact" className="text-gray-700 hover:text-gold-700 font-medium inline-flex items-center whitespace-nowrap">
              <i className="ri-customer-service-2-line mr-1.5" />
              Contact support
            </Link>
            <Link href="/account?tab=orders" className="text-gray-700 hover:text-gold-700 font-medium inline-flex items-center whitespace-nowrap">
              <i className="ri-question-line mr-1.5" />
              Order help
            </Link>
            <Link href="/policy" className="text-gray-700 hover:text-gold-700 font-medium inline-flex items-center whitespace-nowrap">
              <i className="ri-arrow-left-right-line mr-1.5" />
              Exchange & refund
            </Link>
          </div>
        </div>
      </section>

      <style jsx>{`
        @keyframes fall {
          to {
            transform: translateY(100vh) rotate(360deg);
            opacity: 0;
          }
        }
        .animate-fall {
          animation: fall linear forwards;
        }
        @keyframes spin-slow {
          to { transform: rotate(360deg); }
        }
        :global(.animate-spin-slow) {
          animation: spin-slow 3s linear infinite;
        }
      `}</style>
    </main>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-16 h-16 border-4 border-gold-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <OrderSuccessContent />
    </Suspense>
  );
}
