'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import FraudDetectionAlert from '@/components/FraudDetectionAlert';
import {
  ORDER_STATUS_COLORS,
  ORDER_STATUS_OPTIONS,
  formatOrderStatus,
} from '@/lib/order-status';

interface OrderDetailClientProps {
  orderId: string;
}

type RiskLevel = 'low' | 'medium' | 'high';

interface FraudAnalysis {
  riskLevel: RiskLevel;
  reasons: string[];
}

// A size token is a shoe number (e.g. "37", "38.5") or a clothing size.
const looksLikeSize = (v: string) =>
  /^\d{1,2}(\.\d)?$/.test(v) || /^(xs|s|m|l|xl|xxl|xxxl)$/i.test(v);

// Work out the real size and colour for an order line, regardless of how the
// data was originally written. Some older orders (especially POS) saved the
// colour into metadata.size and dropped the size — but the linked
// product_variant still holds the authoritative "Size / Colour" label, so we
// resolve from the variant first and fall back to the line's own fields.
function resolveVariantSizeColor(item: any): { size: string; color: string } {
  const clean = (v: any) => (v == null ? '' : String(v).trim());

  // 1) Authoritative: the linked product_variant ("37 / Coffee", option2 = colour).
  const variant = item?.variant || null;
  if (variant) {
    const nameParts = clean(variant.name).split('/').map((p: string) => p.trim()).filter(Boolean);
    const colorFromVariant = clean(variant.option2) || (nameParts.length > 1 ? nameParts[1] : '');
    let sizeFromVariant = clean(variant.option1);
    if (!sizeFromVariant && nameParts.length > 1) sizeFromVariant = nameParts[0];
    if (!sizeFromVariant && nameParts.length === 1 && looksLikeSize(nameParts[0])) sizeFromVariant = nameParts[0];
    if (sizeFromVariant || colorFromVariant) {
      return { size: sizeFromVariant, color: colorFromVariant };
    }
  }

  // 2) Fall back to the line's own variant_name, e.g. "37 / Black".
  const labelParts = clean(item?.variant_name).split('/').map((p: string) => p.trim()).filter(Boolean);
  if (labelParts.length > 1) {
    return { size: labelParts[0], color: labelParts[1] };
  }

  // 3) Last resort: metadata (may be unreliable on legacy orders).
  const meta = item?.metadata || {};
  const metaSize = clean(meta.size);
  const metaColor = clean(meta.color);
  if (metaColor || (metaSize && looksLikeSize(metaSize))) {
    return { size: looksLikeSize(metaSize) ? metaSize : '', color: metaColor };
  }

  // Single unknown token — treat as size if numeric, otherwise as a colour.
  const lone = labelParts[0] || metaSize;
  if (lone) {
    return looksLikeSize(lone) ? { size: lone, color: '' } : { size: '', color: lone };
  }
  return { size: '', color: '' };
}

export default function OrderDetailClient({ orderId }: OrderDetailClientProps) {
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  // Status the admin has *picked* in the dropdown but not yet committed.
  // The order's actual status only changes when "Update Status" is clicked.
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  // NOTE: Manual "Mark as paid" intentionally disabled. We only trust Moolre's verify
  // endpoint to mark payments; see handleReconcile below.
  // const [markingPaid, setMarkingPaid] = useState(false);
  // const handleMarkPaid = async () => { ... };
  const [reconciling, setReconciling] = useState(false);
  // Per-item cancel / return modal state.
  const [itemAction, setItemAction] = useState<any | null>(null);
  const [itemActionType, setItemActionType] = useState<'cancelled' | 'returned'>('cancelled');
  const [itemActionReason, setItemActionReason] = useState('');
  const [itemActionLoading, setItemActionLoading] = useState(false);
  const [itemActionError, setItemActionError] = useState<string | null>(null);

  const openItemAction = (item: any) => {
    setItemAction(item);
    // After delivery, a removed item is a "return"; before that it's a "cancel".
    setItemActionType(order?.status === 'delivered' ? 'returned' : 'cancelled');
    setItemActionReason('');
    setItemActionError(null);
  };

  const submitItemAction = async () => {
    if (!itemAction) return;
    setItemActionLoading(true);
    setItemActionError(null);
    try {
      const { data, error } = await supabase.rpc('cancel_order_item', {
        p_item_id: itemAction.id,
        p_action: itemActionType,
        p_reason: itemActionReason.trim() || null,
      });
      if (error) throw error;
      if (data && data.ok === false) {
        throw new Error(data.message || 'Could not update this item.');
      }
      setItemAction(null);
      await fetchOrderDetails();
    } catch (err: any) {
      setItemActionError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setItemActionLoading(false);
    }
  };

  const handleReconcile = async () => {
    if (!order) return;
    try {
      setReconciling(true);
      const res = await fetch('/api/payment/moolre/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: order.order_number }),
      });
      const payload = await res.json();

      if (payload.success && payload.payment_status === 'paid') {
        alert('Verified with Moolre — order marked as paid.');
      } else {
        alert(payload.message || 'Could not verify with Moolre yet. Try again in a moment.');
      }

      await fetchOrderDetails();
    } catch (err: any) {
      alert(err.message || 'Reconcile failed');
    } finally {
      setReconciling(false);
    }
  };

  useEffect(() => {
    fetchOrderDetails();
  }, [orderId]);

  const fetchOrderDetails = async () => {
    try {
      setLoading(true);
      // Try to fetch by ID or order_number
      let query = supabase
        .from('orders')
        .select(`
          *,
          order_items (
            id,
            product_id,
            product_name,
            variant_name,
            variant_id,
            sku,
            quantity,
            unit_price,
            total_price,
            metadata,
            status,
            cancel_reason,
            cancelled_at,
            products (
              sku,
              product_code,
              product_images (url)
            ),
            variant:product_variants (
              name,
              option1,
              option2,
              option3,
              sku
            )
          )
        `)
        .eq('id', orderId);

      let { data, error } = await query.single();

      if (error && error.code === 'PGRST116') {
        // Not found by ID, try order_number
        const { data: dataByNum, error: errorByNum } = await supabase
          .from('orders')
          .select(`
            *,
            order_items (
              id,
              product_id,
              product_name,
              variant_name,
              variant_id,
              sku,
              quantity,
              unit_price,
              total_price,
              metadata,
              status,
              cancel_reason,
              cancelled_at,
              products (
                sku,
                product_code,
                product_images (url)
              ),
              variant:product_variants (
                name,
                option1,
                option2,
                option3,
                sku
              )
            )
          `)
          .eq('order_number', orderId)
          .single();

        if (dataByNum) {
          data = dataByNum;
          error = null;
        } else {
          error = errorByNum;
        }
      }

      if (error) throw error;
      setOrder(data);
      setTrackingNumber(data.metadata?.tracking_number || '');
      setAdminNotes(data.notes || '');
      setPendingStatus(null);

    } catch (err: any) {
      console.error('Error fetching order:', err);
      setError('Failed to load order details');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (newStatus?: string) => {
    try {
      setStatusUpdating(true);
      const statusToUpdate = newStatus || order.status;

      // Build update payload
      const updatePayload: any = {
        status: statusToUpdate,
        notes: adminNotes,
        metadata: {
          ...order.metadata,
          tracking_number: trackingNumber
        }
      };

      // If cancelling an order that was paid, auto-set payment_status to refunded
      if (statusToUpdate === 'cancelled' && order.payment_status === 'paid') {
        updatePayload.payment_status = 'refunded';
        updatePayload.cancel_reason = adminNotes || 'Cancelled by admin';
        updatePayload.metadata = {
          ...updatePayload.metadata,
          refund_initiated_at: new Date().toISOString(),
          refund_method: 'original_payment_method',
          refund_note: 'Refund to original payment method initiated on cancellation'
        };
      } else if (statusToUpdate === 'cancelled') {
        updatePayload.cancel_reason = adminNotes || 'Cancelled by admin';
      }

      const { data: updatedRows, error } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', order.id)
        .select('id');

      if (error) throw error;
      // RLS can silently block an update — it returns no error but changes
      // zero rows. Without this guard the UI would report a false "updated"
      // while the order stayed put (the staff "stuck on processing" bug).
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error("This order couldn't be updated. You may not have permission, or the order no longer exists.");
      }

      // Update local state
      setOrder({
        ...order,
        status: statusToUpdate,
        payment_status: updatePayload.payment_status || order.payment_status,
        notes: adminNotes,
        metadata: updatePayload.metadata
      });

      // Send Notification (Email + SMS)
      // Only send if status changed OR tracking number was added/changed
      const statusChanged = statusToUpdate !== order.status;
      const trackingChanged = trackingNumber !== order.metadata?.tracking_number;

      let notifyWarning = '';
      if (statusChanged || (trackingChanged && trackingNumber)) {
        try {
          const res = await fetch('/api/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'order_status',
              payload: {
                email: order.email,
                name: customerName,
                orderId: orderId,
                orderNumber: order.order_number || orderId,
                status: statusToUpdate,
                trackingNumber: trackingNumber,
                phone: shippingAddress.phone || order.phone,
              },
            }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            notifyWarning = body?.error || `Notification failed (HTTP ${res.status})`;
            console.error('Notification error:', notifyWarning);
          }
        } catch (err) {
          notifyWarning = 'Notification request failed';
          console.error('Notification error:', err);
        }
      }

      if (notifyWarning) {
        alert(`Order updated, but notification did not send: ${notifyWarning}`);
      } else {
        alert('Order updated successfully');
      }
      setShowStatusMenu(false);
      setPendingStatus(null);
    } catch (err) {
      console.error('Error updating order:', err);
      alert('Failed to update order');
    } finally {
      setStatusUpdating(false);
    }
  };

  const statusOptions = [...ORDER_STATUS_OPTIONS];
  const statusColors = ORDER_STATUS_COLORS;

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (error || !order) return <div className="p-8 text-center text-red-500">{error || 'Order not found'}</div>;

  const currentStatus = order.status || 'pending';
  const displayStatus = pendingStatus || currentStatus;
  const hasPendingChange = !!pendingStatus && pendingStatus !== currentStatus;
  const shippingAddress = order.shipping_address || {};
  const customerName = shippingAddress.full_name || order.email.split('@')[0];

  // Derive timeline from status (simplified logic as we don't have full history table joined here yet)
  const afterProcessing = [
    'processing', 'packed', 'packaging_for_delivery', 'shipped', 'delivered', 'completed',
  ];
  const afterPacked = ['packed', 'packaging_for_delivery', 'shipped', 'delivered', 'completed'];
  const afterPackaging = ['packaging_for_delivery', 'shipped', 'delivered', 'completed'];
  const afterShipped = ['shipped', 'delivered', 'completed'];
  const timeline = [
    { status: 'Order Placed', date: new Date(order.created_at).toLocaleString(), completed: true },
    { status: 'Payment', date: order.payment_status, completed: order.payment_status === 'paid' || order.metadata?.pos_sale === true },
    { status: 'Processing', date: '', completed: afterProcessing.includes(order.status) },
    { status: 'Packed', date: '', completed: afterPacked.includes(order.status) },
    { status: 'Packaging for Delivery', date: '', completed: afterPackaging.includes(order.status) },
    { status: 'Shipped', date: '', completed: afterShipped.includes(order.status) },
    { status: 'Delivered', date: '', completed: ['delivered', 'completed'].includes(order.status) },
  ];

  // Mock fraud analysis for now (or implement real logic later)
  const fraudAnalysis: FraudAnalysis = {
    riskLevel: 'low',
    reasons: []
  };

  return (
    <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {fraudAnalysis.riskLevel !== 'low' && (
              <FraudDetectionAlert
                riskLevel={fraudAnalysis.riskLevel}
                reasons={fraudAnalysis.reasons}
                orderId={orderId}
              />
            )}

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">Order Items</h2>
                <span className="text-gray-600">{order.order_items?.length || 0} items</span>
              </div>

              <div className="space-y-4">
                {order.order_items?.map((item: any) => {
                  // Show whatever SKU we can find: the linked variant first
                  // (correct for variants), then the order_item, then the parent
                  // product SKU/code for older orders that didn't capture it.
                  const displaySku = (item.variant?.sku || item.sku || item.products?.sku || item.products?.product_code || '').toString().trim();
                  // Resolve Size / Colour from the authoritative linked variant
                  // (falls back to variant_name / metadata for legacy orders), so
                  // the packer always sees the correct size and colour — even on
                  // older orders that saved the colour into the size field.
                  const { size: sizeLabel, color: colorLabel } = resolveVariantSizeColor(item);
                  const itemStatus = (item.status || 'active') as string;
                  const isInactive = itemStatus === 'cancelled' || itemStatus === 'returned';
                  return (
                  <div key={item.id} className={`flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-lg ${isInactive ? 'bg-red-50/40 border border-red-100' : 'bg-gray-50'}`}>
                    <div className="w-14 h-14 sm:w-20 sm:h-20 bg-white rounded-lg overflow-hidden border border-gray-200 flex items-center justify-center relative shrink-0">
                      {item.products?.product_images?.[0]?.url ? (
                        <img
                          src={item.products.product_images[0].url}
                          alt={item.product_name}
                          className={`w-full h-full object-cover ${isInactive ? 'opacity-50 grayscale' : ''}`}
                        />
                      ) : (
                        <i className="ri-image-line text-2xl text-gray-300"></i>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className={`font-semibold mb-1 text-sm sm:text-base truncate ${isInactive ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{item.product_name}</h3>
                      {isInactive && (
                        <div className="mb-1.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${itemStatus === 'returned' ? 'bg-orange-100 text-orange-800 border border-orange-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>
                            <i className={itemStatus === 'returned' ? 'ri-arrow-go-back-line' : 'ri-close-circle-line'}></i>
                            {itemStatus === 'returned' ? 'Returned' : 'Cancelled'}
                          </span>
                          {item.cancel_reason && (
                            <span className="text-[11px] text-gray-500 ml-2 italic">{item.cancel_reason}</span>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {sizeLabel && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">Size</span>
                            <span className="text-xs font-semibold text-indigo-900">{sizeLabel}</span>
                          </span>
                        )}
                        {colorLabel && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 border border-purple-200">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Colour</span>
                            <span className="text-xs font-semibold text-purple-900">{colorLabel}</span>
                          </span>
                        )}
                        {!sizeLabel && !colorLabel && item.variant_name && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 border border-gray-200 text-xs font-semibold text-gray-700">
                            {item.variant_name}
                          </span>
                        )}
                        {displaySku ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">SKU</span>
                            <span className="text-xs font-mono font-semibold text-emerald-900">{displaySku}</span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(displaySku).catch(() => { /* clipboard blocked */ });
                              }}
                              title="Copy SKU"
                              className="text-emerald-700 hover:text-emerald-900"
                            >
                              <i className="ri-file-copy-line text-xs"></i>
                            </button>
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-400 italic">No SKU on file</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 flex flex-col items-end">
                      <p className={`font-semibold mb-1 text-sm sm:text-base ${isInactive ? 'text-gray-400 line-through' : 'text-gray-900'}`}>GH₵ {item.unit_price?.toFixed(2)}</p>
                      <p className="text-sm text-gray-600">Qty: {item.quantity}</p>
                      {!isInactive && (
                        <button
                          type="button"
                          onClick={() => openItemAction(item)}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-white hover:bg-red-600 border border-red-200 hover:border-red-600 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-close-circle-line"></i>
                          Cancel / Return
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>

              <div className="mt-6 pt-6 border-t border-gray-200 space-y-3">
                <div className="flex justify-between text-gray-700">
                  <span>Subtotal</span>
                  <span>GH₵ {order.subtotal?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-700">
                  <span>Shipping</span>
                  <span>GH₵ {order.shipping_total?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-700">
                  <span>Tax</span>
                  <span>GH₵ {order.tax_total?.toFixed(2)}</span>
                </div>
                {order.discount_total > 0 && (
                  <div className="flex justify-between text-emerald-700 font-semibold">
                    <span>Discount</span>
                    <span>-GH₵ {order.discount_total?.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xl font-bold text-gray-900 pt-3 border-t border-gray-200">
                  <span>Total</span>
                  <span>GH₵ {order.total?.toFixed(2)}</span>
                </div>
                {Number(order.metadata?.partial_refund_total) > 0 && (
                  <div className="flex justify-between text-sm font-semibold text-orange-700 pt-2">
                    <span><i className="ri-refund-2-line mr-1"></i>Refunded for cancelled/returned items</span>
                    <span>-GH₵ {Number(order.metadata.partial_refund_total).toFixed(2)}</span>
                  </div>
                )}
              </div>

              {Array.isArray(order.metadata?.item_refunds) && order.metadata.item_refunds.length > 0 && (
                <div className="mt-5 p-4 rounded-lg bg-orange-50 border border-orange-100">
                  <p className="text-sm font-bold text-orange-900 mb-2">
                    <i className="ri-history-line mr-1"></i>
                    Cancellation / Return history
                  </p>
                  <ul className="space-y-1.5">
                    {order.metadata.item_refunds.map((r: any, i: number) => (
                      <li key={i} className="text-xs text-orange-900/90 flex flex-wrap justify-between gap-2">
                        <span>
                          <span className="font-semibold capitalize">{r.type}</span>
                          {' · '}{r.product_name}{r.variant_name ? ` (${r.variant_name})` : ''} × {r.quantity}
                          {r.reason ? <span className="italic text-orange-700"> — {r.reason}</span> : ''}
                          {r.restocked ? <span className="text-emerald-700"> · restocked</span> : ''}
                        </span>
                        <span className="font-semibold whitespace-nowrap">GH₵ {Number(r.amount || 0).toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Order Timeline</h2>
              <div className="space-y-4">
                {timeline.map((event, index) => (
                  <div key={index} className="flex items-start space-x-4">
                    <div className={`w-10 h-10 flex items-center justify-center rounded-full border-2 ${event.completed ? 'bg-emerald-700 border-emerald-700' : 'bg-white border-gray-300'
                      }`}>
                      {event.completed ? (
                        <i className="ri-check-line text-white text-xl"></i>
                      ) : (
                        <span className="w-3 h-3 bg-gray-300 rounded-full"></span>
                      )}
                    </div>
                    <div className="flex-1 pb-6 border-b border-gray-200 last:border-0">
                      <p className={`font-semibold ${event.completed ? 'text-gray-900' : 'text-gray-500'}`}>
                        {event.status}
                      </p>
                      {event.date && (
                        <p className="text-sm text-gray-600 mt-1">{event.date}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Order Status</h2>
              <div className="relative">
                <button
                  onClick={() => setShowStatusMenu(!showStatusMenu)}
                  className={`w-full px-4 py-3 rounded-lg border-2 font-semibold text-left flex items-center justify-between ${statusColors[displayStatus] || 'bg-gray-100'}`}
                >
                  <span>{formatOrderStatus(displayStatus)}</span>
                  <i className="ri-arrow-down-s-line text-xl"></i>
                </button>
                {hasPendingChange && (
                  <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 flex items-center gap-1">
                    <i className="ri-information-line"></i>
                    Pending change — click <strong>Update Status</strong> to save.
                  </p>
                )}
                {showStatusMenu && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-gray-200 rounded-lg shadow-lg overflow-hidden z-10">
                    {statusOptions.map((status) => (
                      <button
                        key={status}
                        onClick={() => {
                          setPendingStatus(status === currentStatus ? null : status);
                          setShowStatusMenu(false);
                        }}
                        className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${status === displayStatus ? 'bg-emerald-50 font-semibold' : ''
                          } ${status === 'cancelled' ? 'text-red-600 hover:bg-red-50' : ''}`}
                      >
                        {formatOrderStatus(status)}
                        {status === 'cancelled' && order.payment_status === 'paid' && (
                          <span className="text-xs text-red-400 ml-2">(will trigger refund)</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {currentStatus === 'returned' && (order.metadata as { return_note?: string })?.return_note && (
                  <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg flex items-start gap-2">
                    <i className="ri-arrow-go-back-line text-orange-600 mt-0.5" />
                    <div className="text-sm text-orange-900">
                      <p className="font-semibold">Rider return note</p>
                      <p className="text-orange-800 mt-1">{(order.metadata as { return_note?: string }).return_note}</p>
                    </div>
                  </div>
                )}

                {/* Refund indicator */}
                {order.payment_status === 'refunded' && (
                  <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
                    <i className="ri-refund-2-line text-blue-600 mt-0.5"></i>
                    <div className="text-sm">
                      <p className="font-semibold text-blue-900">Refund Initiated</p>
                      <p className="text-blue-700">
                        Refund to original payment method.
                        {order.metadata?.refund_initiated_at && (
                          <span className="block text-xs text-blue-500 mt-1">
                            Initiated: {new Date(order.metadata.refund_initiated_at).toLocaleString()}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4">
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Tracking Number
                </label>
                <input
                  type="text"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              <button
                onClick={() => {
                  const next = pendingStatus || currentStatus;
                  if (next === 'cancelled' && order.payment_status === 'paid') {
                    if (!confirm('This order has been paid. Cancelling will automatically initiate a refund to the original payment method. Continue?')) {
                      return;
                    }
                  }
                  handleUpdateStatus(next);
                }}
                disabled={statusUpdating}
                className="w-full mt-4 bg-emerald-700 hover:bg-emerald-800 text-white py-3 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {statusUpdating ? 'Updating...' : 'Update Status'}
              </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Customer</h2>
              <div className="flex items-start space-x-3 mb-4">
                <div className="w-12 h-12 flex items-center justify-center bg-emerald-100 text-emerald-700 rounded-full font-semibold uppercase">
                  {customerName.substring(0, 2)}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{customerName}</p>
                  <p className="text-sm text-gray-600">{order.email}</p>
                  <p className="text-sm text-gray-600">{shippingAddress.phone || order.phone}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">
                {order.metadata?.pos_sale && order.metadata?.pos_order_type !== 'delivery'
                  ? 'Pickup / In-store'
                  : 'Shipping Address'}
              </h2>
              {order.metadata?.pos_sale && order.metadata?.pos_order_type !== 'delivery' ? (
                <div className="flex items-start gap-2 text-gray-700">
                  <i className="ri-store-3-line text-indigo-600 text-lg mt-0.5"></i>
                  <div>
                    <p className="font-semibold">Walk-in POS Sale</p>
                    <p className="text-sm text-gray-500">
                      Customer collected the items in-store. No delivery required.
                    </p>
                    {shippingAddress.note && (
                      <p className="text-xs text-gray-400 mt-1">{shippingAddress.note}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-gray-700 space-y-1">
                  {shippingAddress.address_line1 && <p>{shippingAddress.address_line1}</p>}
                  {shippingAddress.address_line2 && <p>{shippingAddress.address_line2}</p>}
                  {(shippingAddress.city || shippingAddress.state) && (
                    <p>
                      {[shippingAddress.city, shippingAddress.state].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {shippingAddress.postal_code && <p>{shippingAddress.postal_code}</p>}
                  {shippingAddress.country && (
                    <p className="font-semibold">{shippingAddress.country}</p>
                  )}
                  {shippingAddress.notes && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
                        Delivery Notes
                      </p>
                      <p className="text-sm text-gray-700 whitespace-pre-line">
                        {shippingAddress.notes}
                      </p>
                    </div>
                  )}
                  {!shippingAddress.address_line1 &&
                    !shippingAddress.city &&
                    !shippingAddress.state && (
                      <p className="text-sm text-gray-400 italic">
                        No shipping address on file.
                      </p>
                    )}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Payment Info</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Method</span>
                  <span className="font-semibold text-gray-900 capitalize">{order.payment_method}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Status</span>
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-semibold whitespace-nowrap capitalize ${
                      order.payment_status === 'paid'
                        ? 'bg-emerald-100 text-emerald-700'
                        : order.payment_status === 'failed'
                        ? 'bg-red-100 text-red-700'
                        : order.payment_status === 'refunded'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {order.payment_status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Transaction</span>
                  <span className="text-sm text-gray-900 font-mono truncate max-w-[150px]">
                    {order.metadata?.moolre_reference || order.payment_transaction_id || 'N/A'}
                  </span>
                </div>
              </div>

              {order.payment_method === 'moolre' &&
                order.payment_status !== 'paid' &&
                order.payment_status !== 'refunded' && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <button
                      onClick={handleReconcile}
                      disabled={reconciling}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gray-900 hover:bg-black text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {reconciling ? (
                        <>
                          <i className="ri-loader-4-line animate-spin" />
                          Checking with Moolre…
                        </>
                      ) : (
                        <>
                          <i className="ri-refresh-line" />
                          Reconcile with Moolre
                        </>
                      )}
                    </button>
                    <p className="mt-2 text-xs text-gray-500 leading-relaxed">
                      Re-checks this transaction against Moolre. Marks the order paid only
                      if Moolre confirms the payment.
                    </p>
                  </div>
                )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Admin Notes</h2>
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Add internal notes about this order..."
                rows={4}
                maxLength={500}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
              />
              <button
                onClick={() => handleUpdateStatus()}
                disabled={statusUpdating}
                className="w-full mt-3 bg-gray-700 hover:bg-gray-800 text-white py-2 rounded-lg font-medium transition-colors whitespace-nowrap disabled:opacity-50"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Per-item cancel / return modal */}
      {itemAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Remove item from order</h3>
              <button
                onClick={() => !itemActionLoading && setItemAction(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500"
                aria-label="Close"
              >
                <i className="ri-close-line text-xl"></i>
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="w-12 h-12 rounded-lg bg-white border border-gray-200 overflow-hidden flex items-center justify-center shrink-0">
                  {itemAction.products?.product_images?.[0]?.url ? (
                    <img src={itemAction.products.product_images[0].url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <i className="ri-image-line text-gray-300"></i>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{itemAction.product_name}</p>
                  <p className="text-xs text-gray-500">Qty {itemAction.quantity} · GH₵ {Number(itemAction.total_price || 0).toFixed(2)}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">What happened?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setItemActionType('cancelled')}
                    className={`p-3 rounded-lg border text-center transition-colors cursor-pointer ${itemActionType === 'cancelled' ? 'border-red-500 bg-red-50 ring-2 ring-red-200' : 'border-gray-200 hover:border-red-300'}`}
                  >
                    <i className="ri-close-circle-line text-lg text-red-600"></i>
                    <span className="block text-sm font-semibold text-gray-900 mt-0.5">Cancel</span>
                    <span className="block text-[10px] text-gray-500">Before shipping</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setItemActionType('returned')}
                    className={`p-3 rounded-lg border text-center transition-colors cursor-pointer ${itemActionType === 'returned' ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-200' : 'border-gray-200 hover:border-orange-300'}`}
                  >
                    <i className="ri-arrow-go-back-line text-lg text-orange-600"></i>
                    <span className="block text-sm font-semibold text-gray-900 mt-0.5">Return</span>
                    <span className="block text-[10px] text-gray-500">After delivery</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700">Reason (optional)</label>
                <textarea
                  value={itemActionReason}
                  onChange={(e) => setItemActionReason(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder="e.g. Customer changed their mind / wrong size"
                  className="w-full mt-1 px-3 py-2 border-2 border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
                />
              </div>

              <div className="text-xs text-blue-800 bg-blue-50 border border-blue-100 rounded-lg p-3 leading-relaxed">
                This restocks the item, lowers the order total by <span className="font-semibold">GH₵ {Number(itemAction.total_price || 0).toFixed(2)}</span>, and records a refund. The rest of the order stays unchanged.
              </div>

              {itemActionError && <p className="text-sm text-red-600">{itemActionError}</p>}
            </div>

            <div className="px-5 py-4 border-t border-gray-200 flex gap-3">
              <button
                onClick={() => setItemAction(null)}
                disabled={itemActionLoading}
                className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
              >
                Keep item
              </button>
              <button
                onClick={submitItemAction}
                disabled={itemActionLoading}
                className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-2"
              >
                {itemActionLoading ? (
                  <><i className="ri-loader-4-line animate-spin"></i> Processing…</>
                ) : (
                  `Confirm ${itemActionType === 'returned' ? 'return' : 'cancellation'}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
