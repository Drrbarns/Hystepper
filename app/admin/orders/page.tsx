'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import ProductSalesStats from './ProductSalesStats';
import PackingList from './PackingList';
import AdminTableScroll from '@/components/admin/AdminTableScroll';

interface Order {
  id: string;
  order_number: string;
  email: string;
  total: number;
  status: string;
  payment_status?: string;
  payment_method: string;
  payment_provider?: string;
  shipping_method: string;
  created_at: string;
  phone?: string;
  shipping_address?: any;
  metadata?: {
    payable_now?: number;
    delivery_fee_due?: number;
    pos_sale?: boolean;
    pos_order_type?: 'walk_in' | 'delivery';
    [key: string]: any;
  };
  profiles?: {
    full_name: string;
    email: string;
  };
  order_items?: {
    quantity: number;
  }[];
}

function isPosOrder(order: Order): boolean {
  return (
    order.metadata?.pos_sale === true ||
    order.payment_provider === 'pos' ||
    (order.order_number || '').startsWith('POS-')
  );
}

interface OrderStats {
  label: string;
  count: number;
  status: string;
}

// ── Receipt rendering ──────────────────────────────────────────────────────
// These build a fully self-contained receipt document that we render inside an
// <iframe>. Using an iframe (instead of window.open) means: no pop-up blockers,
// the receipt styling is isolated from the admin page, it previews on screen,
// and Print works reliably on mobile.

const escHtml = (s: any) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtMoneyR = (n: any) => `GH₵ ${Number(n || 0).toFixed(2)}`;

const statusLabelR = (status: string) =>
  status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';

const isPosReceipt = (order: any) =>
  order?.metadata?.pos_sale === true ||
  order?.payment_provider === 'pos' ||
  (order?.order_number || '').startsWith('POS-');

// A size token is a shoe number (e.g. "37", "38.5") or a clothing size
// (S / M / L / XL / XXL). Used to tell a size apart from a colour when a
// variant only carries a single label.
const looksLikeSize = (v: string) =>
  /^\d{1,2}(\.\d)?$/.test(v) || /^(xs|s|m|l|xl|xxl|xxxl)$/i.test(v);

// Work out the real size and colour for an order line, regardless of how the
// data was originally written. Some older orders (especially POS) saved the
// colour into metadata.size and dropped the size entirely — but the linked
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

// Sized for 80mm thermal paper (the printable area is ~72mm). Single column,
// compact, monospace — the standard receipt look that thermal printers expect.
// Thermal heads only print solid black well: any grey renders as faint, dithered
// dots, and thin strokes come out faded. So every line is pure #000 and carried
// at a heavier weight, with everything forced fully black when printing.
const RECEIPT_DOC_STYLES = `
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Courier New', ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #000; margin: 0; padding: 16px; background: #e5e7eb;
    font-weight: 600;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet {
    background: #fff; width: 80mm; margin: 0 auto 16px; padding: 14px 12px 18px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.12);
  }
  .center { text-align: center; }
  .muted { color: #000; }
  .bold { font-weight: 800; }
  .store { font-size: 18px; font-weight: 800; letter-spacing: 0.5px; }
  .tagline { font-size: 11px; font-weight: 700; margin-top: 2px; text-transform: uppercase; letter-spacing: 1px; }
  .contact { font-size: 11px; color: #000; margin-top: 3px; line-height: 1.4; }
  .status { display: inline-block; margin-top: 7px; font-size: 11px; font-weight: 800; padding: 2px 10px; border: 1.5px solid #000; border-radius: 4px; letter-spacing: 0.5px; }
  .divider { border-top: 1px dashed #000; margin: 9px 0; }
  .meta { font-size: 11px; line-height: 1.6; }
  .meta .row { display: flex; justify-content: space-between; gap: 10px; }
  .meta .row .k { color: #000; white-space: nowrap; }
  .meta .row .v { text-align: right; font-weight: 800; word-break: break-word; }
  .items { font-size: 11px; }
  .item { margin-bottom: 7px; }
  .item .name { font-weight: 800; font-size: 12px; line-height: 1.3; }
  .item .sub { font-size: 11px; color: #000; font-weight: 600; margin-top: 1px; }
  .item .line { display: flex; justify-content: space-between; gap: 10px; margin-top: 2px; }
  .item .line .amt { font-weight: 800; white-space: nowrap; }
  .totals { font-size: 12px; }
  .totals .row { display: flex; justify-content: space-between; gap: 10px; padding: 1px 0; }
  .totals .row .amt { font-variant-numeric: tabular-nums; font-weight: 700; }
  .totals .grand { font-size: 15px; font-weight: 800; border-top: 1.5px solid #000; margin-top: 5px; padding-top: 5px; }
  .footer { text-align: center; font-size: 11px; color: #000; margin-top: 10px; line-height: 1.5; }
  .thanks { font-weight: 800; color: #000; font-size: 12px; margin-bottom: 3px; }
  .notes { margin-top: 8px; font-size: 11px; border: 1px dashed #000; padding: 6px 8px; }
  .page-break { page-break-after: always; }
  @media print {
    body { background: #fff; padding: 0; font-weight: 700; }
    .sheet { box-shadow: none; width: 80mm; margin: 0; padding: 4px 8px 10px; }
    /* Thermal heads can't render grey — force every glyph to solid black. */
    * { color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

function buildReceiptSheet(order: any, settings: any): string {
  const dt = new Date(order.created_at || Date.now());
  const dateStr = dt.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const ship = order.shipping_address || {};
  const customerName =
    ship.full_name ||
    [ship.first_name, ship.last_name].filter(Boolean).join(' ').trim() ||
    (order.email ? order.email.split('@')[0] : 'Guest');
  const customerPhone = order.phone || ship.phone || '';

  const isPos = isPosReceipt(order);
  const docTitle = isPos ? 'Sales Receipt' : 'Order Invoice';

  const itemsHtml = (order.order_items || [])
    .map((item: any) => {
      const { size: sizeLabel, color: colorLabel } = resolveVariantSizeColor(item);
      const sku = (
        item.variant?.sku || item.sku || item.products?.sku || item.products?.product_code || ''
      ).toString().trim();
      const subParts = [
        sizeLabel ? `Size ${escHtml(sizeLabel)}` : '',
        colorLabel ? escHtml(colorLabel) : '',
        sku ? `SKU ${escHtml(sku)}` : '',
      ].filter(Boolean).join(' · ');
      return `
        <div class="item">
          <div class="name">${escHtml(String(item.product_name || '').trim())}</div>
          ${subParts ? `<div class="sub">${subParts}</div>` : ''}
          <div class="line"><span>${item.quantity} × ${fmtMoneyR(item.unit_price)}</span><span class="amt">${fmtMoneyR(item.total_price)}</span></div>
        </div>`;
    })
    .join('');

  const storeName = settings?.store_name || 'Hy_stepper';
  const storePhone = settings?.contact_phone || '';
  const storeEmail = settings?.contact_email || '';
  const storeAddress = (settings?.contact_address || '')
    .split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);

  const paymentLabel = (() => {
    const m = (order.payment_method || '').toString().toLowerCase();
    if (m === 'cash') return 'Cash';
    if (m === 'mobile_money' || m === 'momo') return 'Mobile Money';
    if (m === 'card') return 'Card';
    if (order.payment_provider) return order.payment_provider.toString();
    return order.payment_method || 'Paid';
  })();

  const payable = Number(order.metadata?.payable_now ?? order.total) || 0;
  const dueLater = Number(order.metadata?.delivery_fee_due ?? 0) || 0;
  const paymentStatusText = (order.payment_status || 'unpaid').toString().toUpperCase();
  const ref = order.order_number || order.id.slice(0, 8);

  const contactHtml = [
    ...storeAddress.map((l: string) => `<div class="contact">${escHtml(l)}</div>`),
    storePhone ? `<div class="contact">Tel: ${escHtml(storePhone)}</div>` : '',
    storeEmail ? `<div class="contact">${escHtml(storeEmail)}</div>` : '',
  ].filter(Boolean).join('');

  return `
  <div class="sheet">
    <div class="center">
      <div class="store">${escHtml(storeName)}</div>
      <div class="tagline">${escHtml(docTitle)}</div>
      ${contactHtml}
      <div class="status">${escHtml(paymentStatusText)}</div>
    </div>

    <div class="divider"></div>

    <div class="meta">
      <div class="row"><span class="k">Receipt</span><span class="v">#${escHtml(ref)}</span></div>
      <div class="row"><span class="k">Date</span><span class="v">${escHtml(dateStr)}</span></div>
      <div class="row"><span class="k">Customer</span><span class="v">${escHtml(customerName)}</span></div>
      ${customerPhone ? `<div class="row"><span class="k">Phone</span><span class="v">${escHtml(customerPhone)}</span></div>` : ''}
      <div class="row"><span class="k">Status</span><span class="v">${escHtml(statusLabelR(order.status))}</span></div>
      <div class="row"><span class="k">Payment</span><span class="v">${escHtml(paymentLabel)}</span></div>
      <div class="row"><span class="k">Source</span><span class="v">${isPos ? 'POS / In-store' : 'Online Store'}</span></div>
      ${order.shipping_method ? `<div class="row"><span class="k">Delivery</span><span class="v">${escHtml(order.shipping_method)}</span></div>` : ''}
    </div>

    <div class="divider"></div>

    <div class="items">
      ${itemsHtml || '<div class="center muted" style="padding:8px 0;">No items found</div>'}
    </div>

    <div class="divider"></div>

    <div class="totals">
      ${order.subtotal != null ? `<div class="row"><span>Subtotal</span><span class="amt">${fmtMoneyR(order.subtotal)}</span></div>` : ''}
      ${order.shipping_total ? `<div class="row"><span>Shipping</span><span class="amt">${fmtMoneyR(order.shipping_total)}</span></div>` : ''}
      ${order.tax_total ? `<div class="row"><span>Tax</span><span class="amt">${fmtMoneyR(order.tax_total)}</span></div>` : ''}
      ${order.discount_total ? `<div class="row"><span>Discount</span><span class="amt">- ${fmtMoneyR(order.discount_total)}</span></div>` : ''}
      <div class="row grand"><span>TOTAL</span><span class="amt">${fmtMoneyR(order.total)}</span></div>
      ${dueLater > 0 ? `
        <div class="row"><span>Paid online</span><span class="amt">${fmtMoneyR(payable)}</span></div>
        <div class="row"><span>Due on delivery</span><span class="amt">${fmtMoneyR(dueLater)}</span></div>
      ` : ''}
    </div>

    ${order.notes ? `<div class="notes"><span class="bold">Notes:</span> ${escHtml(order.notes)}</div>` : ''}

    <div class="divider"></div>

    <div class="footer">
      <div class="thanks">Thank you for shopping with ${escHtml(storeName)}!</div>
      <div>Faulty items: report within 48 hours of delivery.</div>
      <div>Other issues: report within 24 hours. Items must be unused, unworn and in original packaging.</div>
      ${storePhone || storeEmail ? `<div style="margin-top:5px;">Questions? ${storePhone ? `Call ${escHtml(storePhone)}` : ''}${storePhone && storeEmail ? ' · ' : ''}${storeEmail ? `Email ${escHtml(storeEmail)}` : ''}</div>` : ''}
    </div>
  </div>`;
}

function wrapReceiptDoc(title: string, innerHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${escHtml(title)}</title><style>${RECEIPT_DOC_STYLES}</style></head><body>${innerHtml}</body></html>`;
}

const RECEIPT_ITEMS_SELECT = `
  id, order_number, email, phone, status, payment_status,
  payment_method, payment_provider, shipping_method, created_at,
  subtotal, shipping_total, tax_total, discount_total, total,
  notes, shipping_address, billing_address, metadata,
  order_items (
    id, product_name, variant_name, variant_id, sku, quantity,
    unit_price, total_price, metadata,
    products ( sku, product_code ),
    variant:product_variants ( name, option1, option2, option3, sku )
  )
`;

export default function AdminOrdersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [orderViewTab, setOrderViewTab] = useState<'confirmed' | 'abandoned' | 'receipts' | 'packing'>('confirmed');

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'packing' || tab === 'abandoned' || tab === 'receipts' || tab === 'confirmed') {
      setOrderViewTab(tab);
    }
  }, []);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState('date');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderStats, setOrderStats] = useState<OrderStats[]>([
    { label: 'All Orders', count: 0, status: 'all' },
    { label: 'Pending', count: 0, status: 'pending' },
    { label: 'Processing', count: 0, status: 'processing' },
    { label: 'Shipped', count: 0, status: 'shipped' },
    { label: 'Delivered', count: 0, status: 'delivered' },
    { label: 'Returned', count: 0, status: 'returned' },
    { label: 'Cancelled', count: 0, status: 'cancelled' }
  ]);
  const [showProductStats, setShowProductStats] = useState(false);
  const [isRider, setIsRider] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [sendingPaymentLink, setSendingPaymentLink] = useState<string | null>(null);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [abandonedCount, setAbandonedCount] = useState(0);

  const [riderUserId, setRiderUserId] = useState<string | null>(null);

  // ── Receipt preview / print modal ──
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptDocHtml, setReceiptDocHtml] = useState('');
  const [receiptTitle, setReceiptTitle] = useState('Receipt');
  const [receiptCount, setReceiptCount] = useState(1);

  useEffect(() => {
    async function checkRole() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: staffRow } = await supabase
          .from('staff')
          .select('role')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (staffRow?.role === 'rider') {
          setIsRider(true);
          setRiderUserId(session.user.id);
        }
      }
    }
    checkRole();
  }, []);

  useEffect(() => {
    fetchOrders();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRider, riderUserId]);

  // An order belongs to "Confirmed Orders" when it's been paid OR it was
  // rung up at the POS. POS sales are real confirmed sales even when the
  // customer chose pay-on-delivery (payment_status sits at 'pending' until
  // the rider collects cash and marks the order delivered). Anything else
  // with an unpaid status is a true abandoned cart.
  const isConfirmedOrder = (o: any) => {
    if (o?.payment_status === 'paid') return true;
    const meta = (o?.metadata || {}) as Record<string, unknown>;
    return meta.pos_sale === true;
  };

  useEffect(() => {
    if (orderViewTab === 'packing') return;
    const sourceOrders = orderViewTab === 'confirmed'
      ? orders.filter(isConfirmedOrder)
      : orderViewTab === 'abandoned'
      ? orders.filter((o) => !isConfirmedOrder(o))
      : orders; // 'receipts' tab covers every order
    setOrderStats([
      { label: 'All Orders', count: sourceOrders.length, status: 'all' },
      { label: 'Pending', count: sourceOrders.filter(o => o.status === 'pending').length, status: 'pending' },
      { label: 'Processing', count: sourceOrders.filter(o => o.status === 'processing').length, status: 'processing' },
      { label: 'Shipped', count: sourceOrders.filter(o => o.status === 'shipped').length, status: 'shipped' },
      { label: 'Delivered', count: sourceOrders.filter(o => o.status === 'delivered').length, status: 'delivered' },
      { label: 'Returned', count: sourceOrders.filter(o => o.status === 'returned').length, status: 'returned' },
      { label: 'Cancelled', count: sourceOrders.filter(o => o.status === 'cancelled').length, status: 'cancelled' }
    ]);
    setStatusFilter('all');
  }, [orders, orderViewTab]);

  const fetchOrders = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('orders')
        .select(`
          id,
          order_number,
          email,
          total,
          status,
          payment_status,
          payment_method,
          payment_provider,
          shipping_method,
          created_at,
          phone,
          shipping_address,
          metadata,
          rider_id,
          rider_notes,
          assigned_at,
          order_items (quantity)
        `)
        .order('created_at', { ascending: false });

      // Riders only see their own assigned orders
      if (isRider && riderUserId) {
        query = query.eq('rider_id', riderUserId);
      }

      const { data: ordersData, error } = await query;

      if (error) throw error;

      setOrders(ordersData || []);
      const confirmedOrders = (ordersData || []).filter(isConfirmedOrder);
      const abandonedOrders = (ordersData || []).filter(o => !isConfirmedOrder(o));
      setConfirmedCount(confirmedOrders.length);
      setAbandonedCount(abandonedOrders.length);

    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRiderStatusUpdate = async (orderId: string, newStatus: 'delivered' | 'completed') => {
    setUpdatingStatus(orderId);
    try {
      const { data: updatedRows, error } = await supabase
        .from('orders')
        .update({ status: newStatus })
        .eq('id', orderId)
        .select('id');
      if (error) throw error;
      // RLS-blocked updates return no error but zero rows — surface that
      // instead of silently pretending the status changed.
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error("Update was blocked — you may not have permission to change this order.");
      }
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
    } catch (err) {
      console.error('Failed to update order status:', err);
      alert(err instanceof Error ? err.message : 'Failed to update order status.');
    } finally {
      setUpdatingStatus(null);
    }
  };

  const statusColors: Record<string, string> = {
    'pending': 'bg-amber-100 text-amber-700 border-amber-200',
    'processing': 'bg-blue-100 text-blue-700 border-blue-200',
    'shipped': 'bg-purple-100 text-purple-700 border-purple-200',
    'delivered': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'completed': 'bg-emerald-100 text-emerald-800 border-emerald-200',
    'returned': 'bg-orange-100 text-orange-800 border-orange-200',
    'cancelled': 'bg-red-100 text-red-700 border-red-200',
    'awaiting_payment': 'bg-gray-100 text-gray-700 border-gray-200'
  };

  const formatStatus = (status: string) => {
    return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  };

  const getCustomerName = (order: Order) => {
    if (order.shipping_address?.full_name) return order.shipping_address.full_name;
    if (order.profiles?.full_name) return order.profiles.full_name;
    if (order.email) {
      const name = order.email.split('@')[0];
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return 'Guest';
  };

  const getCustomerEmail = (order: Order) => {
    return order.email || order.profiles?.email || 'N/A';
  };

  const getCustomerAvatar = (order: Order) => {
    const name = getCustomerName(order);
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return parts[0][0] + parts[1][0];
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getItemCount = (order: Order) => {
    if (!order.order_items) return 0;
    return order.order_items.reduce((sum, item) => sum + item.quantity, 0);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const handleSelectAll = () => {
    if (selectedOrders.length === filteredOrders.length) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(filteredOrders.map(o => o.id));
    }
  };

  const handleSelectOrder = (orderId: string) => {
    if (selectedOrders.includes(orderId)) {
      setSelectedOrders(selectedOrders.filter(id => id !== orderId));
    } else {
      setSelectedOrders([...selectedOrders, orderId]);
    }
  };

  const handleBulkAction = async (action: string, newStatus?: string) => {
    if (newStatus) {
      try {
        const { data: bulkUpdated, error } = await supabase
          .from('orders')
          .update({ status: newStatus })
          .in('id', selectedOrders)
          .select('id');

        if (error) throw error;
        // RLS-blocked updates return no error but zero rows changed.
        if (!bulkUpdated || bulkUpdated.length === 0) {
          throw new Error("No orders were updated — you may not have permission to change these orders.");
        }



        // Send Notifications
        const updatedOrders = orders.filter(o => selectedOrders.includes(o.id));
        updatedOrders.forEach(order => {
          fetch('/api/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'order_updated',
              payload: { order, status: newStatus }
            })
          }).catch(err => console.error('Notification error', err));
        });

        await fetchOrders();
        setSelectedOrders([]);
        alert(`${selectedOrders.length} orders updated to ${newStatus}`);
      } catch (error) {
        console.error('Error updating orders:', error);
        alert(error instanceof Error ? error.message : 'Failed to update orders');
      }
    } else if (action === 'Export') {
      const ordersToExport = orders.filter(o => selectedOrders.includes(o.id));
      const csvContent = `Order ID,Source,Customer,Email,Date,Items,Total,Status,Payment\n${ordersToExport.map(o =>
        `${o.order_number || o.id},${isPosOrder(o) ? 'POS' : 'Online'},${getCustomerName(o)},${getCustomerEmail(o)},${formatDate(o.created_at)},${getItemCount(o)},${o.total},${o.status},${o.payment_method || 'N/A'}`
      ).join('\n')}`;
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'selected-orders.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }
  };

  const handleExportAll = () => {
    const csvContent = `Order ID,Source,Customer,Email,Date,Items,Total,Status,Payment\n${orders.map(o =>
      `${o.order_number || o.id},${isPosOrder(o) ? 'POS' : 'Online'},${getCustomerName(o)},${getCustomerEmail(o)},${formatDate(o.created_at)},${getItemCount(o)},${o.total},${o.status},${o.payment_method || 'N/A'}`
    ).join('\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'all-orders.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  // Fetch one or more orders (with their items) plus store settings, used to
  // build printable receipts. The list view only pulls quantities, so we
  // re-fetch the full rows here to get SKUs, sizes/colours and totals.
  const fetchReceiptData = async (orderIds: string[]) => {
    const { data: ordersData, error: ordersError } = await supabase
      .from('orders')
      .select(RECEIPT_ITEMS_SELECT)
      .in('id', orderIds);
    if (ordersError) throw ordersError;
    if (!ordersData || ordersData.length === 0) throw new Error('Order not found');

    const { data: settings } = await supabase
      .from('store_settings')
      .select('store_name, contact_phone, contact_email, contact_address, logo_url')
      .maybeSingle();

    // Preserve the order of the ids we were given.
    const byId = new Map((ordersData as any[]).map((o) => [o.id, o]));
    const ordered = orderIds.map((id) => byId.get(id)).filter(Boolean) as any[];
    return { orders: ordered, settings };
  };

  // Open the in-page receipt preview for a single order (no pop-up window).
  const openReceipt = async (orderId: string) => {
    setReceiptModalOpen(true);
    setReceiptLoading(true);
    setReceiptError(null);
    setReceiptDocHtml('');
    setReceiptCount(1);
    setReceiptTitle('Receipt');
    try {
      const { orders: fetched, settings } = await fetchReceiptData([orderId]);
      const order = fetched[0];
      const title = isPosReceipt(order) ? 'Sales Receipt' : 'Order Invoice';
      setReceiptTitle(title);
      setReceiptDocHtml(
        wrapReceiptDoc(`${title} ${order.order_number || order.id.slice(0, 8)}`, buildReceiptSheet(order, settings))
      );
    } catch (err) {
      setReceiptError((err as Error)?.message || 'Could not load this receipt.');
    } finally {
      setReceiptLoading(false);
    }
  };

  // Open a combined preview of several receipts (one per printed page) so they
  // can be printed in one go. Used by the "Print receipts" bulk action.
  const openBulkReceipts = async (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    setReceiptModalOpen(true);
    setReceiptLoading(true);
    setReceiptError(null);
    setReceiptDocHtml('');
    setReceiptCount(orderIds.length);
    setReceiptTitle(`Receipts (${orderIds.length})`);
    try {
      const { orders: fetched, settings } = await fetchReceiptData(orderIds);
      const inner = fetched
        .map((o, i) => buildReceiptSheet(o, settings) + (i < fetched.length - 1 ? '<div class="page-break"></div>' : ''))
        .join('');
      setReceiptCount(fetched.length);
      setReceiptDocHtml(wrapReceiptDoc(`Receipts (${fetched.length})`, inner));
    } catch (err) {
      setReceiptError((err as Error)?.message || 'Could not load these receipts.');
    } finally {
      setReceiptLoading(false);
    }
  };

  // Print the receipt in a throwaway hidden iframe. Writing the document with
  // document.write (instead of printing the on-screen srcDoc iframe) guarantees
  // the browser prints ONLY the receipt — the admin page never bleeds into the
  // print preview. No pop-up, so it works on mobile too.
  const printReceiptIframe = () => {
    if (!receiptDocHtml) return;

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.visibility = 'hidden';
    document.body.appendChild(frame);

    const doc = frame.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(frame);
      return;
    }

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      try { document.body.removeChild(frame); } catch { /* already removed */ }
    };

    doc.open();
    doc.write(receiptDocHtml);
    doc.close();

    const win = frame.contentWindow!;
    win.onafterprint = cleanup;

    // Give the thermal layout a tick to lay out before printing.
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        cleanup();
      }
    }, 200);

    // Safety net in case onafterprint never fires (some browsers).
    setTimeout(cleanup, 60000);
  };

  const closeReceiptModal = () => {
    setReceiptModalOpen(false);
    setReceiptDocHtml('');
    setReceiptError(null);
  };

  const handleResendPaymentLink = async (order: Order) => {
    setSendingPaymentLink(order.id);
    try {
      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'payment_link',
          payload: order
        })
      });

      if (!response.ok) throw new Error('Failed to send payment link');
      alert(`Payment link sent to ${order.phone || order.email}`);
    } catch (error) {
      console.error('Error sending payment link:', error);
      alert('Failed to send payment link');
    } finally {
      setSendingPaymentLink(null);
    }
  };

  const tabOrders = orders.filter((order) => {
    if (orderViewTab === 'packing') return false;
    if (orderViewTab === 'receipts') return true; // every order has a receipt
    const confirmed = isConfirmedOrder(order);
    return orderViewTab === 'confirmed' ? confirmed : !confirmed;
  });

  const filteredOrders = tabOrders.filter(order => {
    const customerName = getCustomerName(order).toLowerCase();
    const customerEmail = getCustomerEmail(order).toLowerCase();
    const orderId = (order.order_number || order.id).toLowerCase();

    const matchesSearch = orderId.includes(searchQuery.toLowerCase()) ||
      customerName.includes(searchQuery.toLowerCase()) ||
      customerEmail.includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    return matchesSearch && matchesStatus;
  }).sort((a, b) => {
    if (sortBy === 'total') return (b.total || 0) - (a.total || 0);
    if (sortBy === 'customer') return getCustomerName(a).localeCompare(getCustomerName(b));
    if (sortBy === 'status') return a.status.localeCompare(b.status);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // Rider-only view: simplified delivery update panel
  if (isRider) {
    const activeOrders = orders.filter(o => !['delivered', 'completed', 'cancelled'].includes(o.status));
    const doneOrders = orders.filter(o => ['delivered', 'completed'].includes(o.status));

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-sky-100 rounded-xl text-sky-600 text-xl shrink-0">🛵</div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">My Deliveries</h1>
              <p className="text-sm text-gray-500">Orders assigned to you — mark them when delivered</p>
            </div>
          </div>
          <div className="flex gap-3 shrink-0">
            <div className="text-center px-4 py-2 bg-sky-50 rounded-xl border border-sky-200">
              <p className="text-xl font-bold text-sky-700">{activeOrders.length}</p>
              <p className="text-xs text-sky-600">Active</p>
            </div>
            <div className="text-center px-4 py-2 bg-emerald-50 rounded-xl border border-emerald-200">
              <p className="text-xl font-bold text-emerald-700">{doneOrders.length}</p>
              <p className="text-xs text-emerald-600">Done</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <i className="ri-loader-4-line animate-spin text-2xl mr-2"></i> Loading orders...
          </div>
        ) : (
          <>
            {/* Active / In-transit orders */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">Active Orders</h2>
                <span className="text-xs bg-sky-100 text-sky-700 font-semibold px-2.5 py-1 rounded-full">{activeOrders.length}</span>
              </div>
              {activeOrders.length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                  <i className="ri-check-double-line text-4xl mb-2 block text-emerald-400"></i>
                  <p className="font-medium">No active deliveries</p>
                  <p className="text-sm mt-1">Your next orders will appear here once assigned</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {activeOrders.map(order => (
                    <div key={order.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-gray-900">{order.order_number || order.id.substring(0, 8)}</p>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusColors[order.status] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                              {formatStatus(order.status)}
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 font-medium">{getCustomerName(order)}</p>
                          {order.phone && (
                            <p className="text-sm text-gray-500 mt-0.5">
                              <i className="ri-phone-line mr-1"></i>{order.phone}
                            </p>
                          )}
                          {(order.shipping_address?.address || order.shipping_address?.deliveryArea) && (
                            <p className="text-sm text-gray-500 mt-0.5">
                              <i className="ri-map-pin-line mr-1"></i>
                              {order.shipping_address.address || order.shipping_address.deliveryArea}
                              {order.shipping_address.region ? `, ${order.shipping_address.region}` : ''}
                            </p>
                          )}
                          {(order as any).rider_notes && (
                            <div className="mt-2 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                              <i className="ri-sticky-note-line text-amber-500 mt-0.5 shrink-0"></i>
                              <p className="text-xs text-amber-700">{(order as any).rider_notes}</p>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                          <button
                            onClick={() => handleRiderStatusUpdate(order.id, 'delivered')}
                            disabled={updatingStatus === order.id}
                            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
                          >
                            {updatingStatus === order.id ? <i className="ri-loader-4-line animate-spin"></i> : '✓ Delivered'}
                          </button>
                          <button
                            onClick={() => handleRiderStatusUpdate(order.id, 'completed')}
                            disabled={updatingStatus === order.id}
                            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
                          >
                            {updatingStatus === order.id ? <i className="ri-loader-4-line animate-spin"></i> : '✓ Completed'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Done orders */}
            {doneOrders.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-800">Completed / Delivered</h2>
                  <span className="text-xs bg-emerald-100 text-emerald-700 font-semibold px-2.5 py-1 rounded-full">{doneOrders.length}</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {doneOrders.map(order => (
                    <div key={order.id} className="flex items-center justify-between px-5 py-4 gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900">{order.order_number || order.id.substring(0, 8)}</p>
                        <p className="text-sm text-gray-500 truncate">{getCustomerName(order)}</p>
                        {order.phone && <p className="text-xs text-gray-400">{order.phone}</p>}
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border shrink-0 ${statusColors[order.status] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                        {formatStatus(order.status)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Orders</h1>
          <p className="text-gray-600 mt-1 text-sm sm:text-base">Manage and track all customer orders</p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            onClick={() => setShowProductStats(true)}
            className="flex-1 md:flex-none bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer shadow-sm flex items-center justify-center"
          >
            <i className="ri-bar-chart-groupped-line mr-2"></i>
            Stats
          </button>
          <button
            onClick={handleExportAll}
            className="flex-1 md:flex-none bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer shadow-sm flex items-center justify-center"
          >
            <i className="ri-download-line mr-2"></i>
            Export
          </button>
        </div>
      </div>

      <div className="flex items-center gap-6 border-b border-gray-200">
        <button
          onClick={() => setOrderViewTab('confirmed')}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${orderViewTab === 'confirmed' ? 'text-emerald-700 border-emerald-600' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          <i className="ri-check-double-line mr-1"></i>
          Confirmed Orders ({confirmedCount})
        </button>
        <button
          onClick={() => setOrderViewTab('abandoned')}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${orderViewTab === 'abandoned' ? 'text-amber-700 border-amber-600' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          <i className="ri-shopping-cart-line mr-1"></i>
          Abandoned Carts ({abandonedCount})
        </button>
        <button
          onClick={() => setOrderViewTab('receipts')}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${orderViewTab === 'receipts' ? 'text-blue-700 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          <i className="ri-receipt-line mr-1"></i>
          Receipts ({orders.length})
        </button>
        <button
          onClick={() => setOrderViewTab('packing')}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${orderViewTab === 'packing' ? 'text-violet-700 border-violet-600' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          <i className="ri-box-3-line mr-1"></i>
          Packing List
        </button>
      </div>

      {orderViewTab === 'packing' ? (
        <PackingList />
      ) : (
      <>

      {orderViewTab === 'abandoned' ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-800 text-sm">
          <p className="font-semibold mb-1"><i className="ri-information-line mr-1"></i>Abandoned Carts</p>
          <p>These orders were created but payment was not completed. You can resend payment links to customers.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {orderStats.map((stat) => (
            <button
              key={stat.status}
              onClick={() => setStatusFilter(stat.status)}
              className={`p-4 rounded-xl border-2 transition-all text-left cursor-pointer ${statusFilter === stat.status
                ? 'border-emerald-700 bg-emerald-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
            >
              <p className="text-2xl font-bold text-gray-900">{stat.count}</p>
              <p className="text-sm text-gray-600 mt-1">{stat.label}</p>
            </button>
          ))}
        </div>
      )}

      {orderViewTab === 'receipts' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-blue-800 text-sm">
            <p className="font-semibold mb-0.5"><i className="ri-receipt-line mr-1"></i>Receipts</p>
            <p>View and print a receipt for any order. Tick rows to print several at once, or print everything shown.</p>
          </div>
          <button
            onClick={() => openBulkReceipts(filteredOrders.map((o) => o.id))}
            disabled={filteredOrders.length === 0}
            className="shrink-0 inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-printer-line"></i>
            Print all shown ({filteredOrders.length})
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg w-5 h-5 flex items-center justify-center"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by order ID, customer name, or email..."
                  className="w-full pl-12 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 transition-colors font-medium whitespace-nowrap cursor-pointer"
              >
                <i className="ri-filter-line mr-2"></i>
                Filters
              </button>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-medium cursor-pointer"
              >
                <option value="date">Sort by Date</option>
                <option value="total">Sort by Total</option>
                <option value="customer">Sort by Customer</option>
                <option value="status">Sort by Status</option>
              </select>
            </div>
          </div>

          {showFilters && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Date Range</label>
                <input type="date" className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method</label>
                <select className="w-full px-3 py-2 pr-8 border-2 border-gray-300 rounded-lg text-sm cursor-pointer">
                  <option>All Methods</option>
                  <option>Mobile Money</option>
                  <option>Card</option>
                  <option>Cash on Delivery</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Shipping Method</label>
                <select className="w-full px-3 py-2 pr-8 border-2 border-gray-300 rounded-lg text-sm cursor-pointer">
                  <option>All Methods</option>
                  <option>Standard</option>
                  <option>Express</option>
                  <option>Manual</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {selectedOrders.length > 0 && (
          <div className="p-4 bg-emerald-50 border-b border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-emerald-800 font-semibold text-sm">
              {selectedOrders.length} order{selectedOrders.length > 1 ? 's' : ''} selected
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleBulkAction('Mark as Processing', 'processing')}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                Mark Processing
              </button>
              <button
                onClick={() => handleBulkAction('Mark as Shipped', 'shipped')}
                className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                Mark Shipped
              </button>
              <button
                onClick={() => openBulkReceipts(selectedOrders)}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <i className="ri-printer-line mr-2"></i>
                Print Receipts
              </button>
              <button
                onClick={() => handleBulkAction('Export')}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <i className="ri-download-line mr-2"></i>
                Export
              </button>
            </div>
          </div>
        )}

        <AdminTableScroll>
          <table className="w-full min-w-[54rem]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="py-4 px-6">
                  <input
                    type="checkbox"
                    checked={selectedOrders.length === filteredOrders.length && filteredOrders.length > 0}
                    onChange={handleSelectAll}
                    className="w-4 h-4 text-emerald-700 border-gray-300 rounded focus:ring-emerald-500 cursor-pointer"
                  />
                </th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Order ID</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Customer</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Date</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Items</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Total</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Payment</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-gray-500">
                    <i className="ri-loader-4-line animate-spin text-3xl text-emerald-700"></i>
                    <p className="mt-2">Loading orders...</p>
                  </td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-gray-500">
                    <i className="ri-inbox-line text-4xl text-gray-300"></i>
                    <p className="mt-2">No orders found</p>
                    <p className="text-sm">Orders will appear here when customers place them</p>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <input
                        type="checkbox"
                        checked={selectedOrders.includes(order.id)}
                        onChange={() => handleSelectOrder(order.id)}
                        className="w-4 h-4 text-emerald-700 border-gray-300 rounded focus:ring-emerald-500 cursor-pointer"
                      />
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <Link href={`/admin/orders/${order.id}`} className="text-emerald-700 hover:text-emerald-800 font-semibold cursor-pointer">
                          {order.order_number || order.id.substring(0, 8)}
                        </Link>
                        {isPosOrder(order) ? (
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                              order.metadata?.pos_order_type === 'delivery'
                                ? 'bg-amber-100 text-amber-800 border-amber-200'
                                : 'bg-indigo-100 text-indigo-700 border-indigo-200'
                            }`}
                          >
                            <i
                              className={`text-[11px] ${
                                order.metadata?.pos_order_type === 'delivery'
                                  ? 'ri-truck-line'
                                  : 'ri-store-3-line'
                              }`}
                            ></i>
                            {order.metadata?.pos_order_type === 'delivery' ? 'POS · Delivery' : 'POS'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
                            <i className="ri-global-line text-[11px]"></i>
                            Online
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 flex items-center justify-center bg-gray-200 text-gray-700 rounded-full font-semibold text-sm">
                          {getCustomerAvatar(order)}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 whitespace-nowrap">{getCustomerName(order)}</p>
                          <p className="text-sm text-gray-500">{getCustomerEmail(order)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-gray-700 text-sm whitespace-nowrap">{formatDate(order.created_at)}</td>
                    <td className="py-4 px-4 text-gray-700">{getItemCount(order)}</td>
                    <td className="py-4 px-4 whitespace-nowrap">
                      {(() => {
                        const payableNow = Number(order.metadata?.payable_now);
                        const deliveryDue = Number(order.metadata?.delivery_fee_due);
                        const isPartial =
                          Number.isFinite(payableNow) &&
                          payableNow > 0 &&
                          Number.isFinite(deliveryDue) &&
                          deliveryDue > 0 &&
                          Math.abs(payableNow + deliveryDue - Number(order.total)) < 0.01;

                        if (isPartial) {
                          return (
                            <div className="leading-tight">
                              <p className="font-semibold text-gray-900 text-sm">
                                GH₵ {payableNow.toFixed(2)}
                              </p>
                              <p className="text-[11px] text-amber-600">
                                + GH₵ {deliveryDue.toFixed(2)} on delivery
                              </p>
                            </div>
                          );
                        }
                        return (
                          <p className="font-semibold text-gray-900 text-sm">
                            GH₵ {order.total?.toFixed(2) || '0.00'}
                          </p>
                        );
                      })()}
                    </td>
                    <td className="py-4 px-4 text-gray-700 text-sm whitespace-nowrap">
                      <p>{order.payment_method || 'N/A'}</p>
                      {orderViewTab === 'abandoned' && (
                        <p className={`text-xs mt-0.5 ${order.payment_status === 'failed' ? 'text-red-600' : 'text-amber-600'}`}>
                          {order.payment_status === 'failed' ? 'Failed' : 'Pending'}
                        </p>
                      )}
                      {/* Confirmed POS sale that's pay-on-delivery — flag it so
                          the admin knows cash is still owed until the rider
                          collects on delivery. */}
                      {orderViewTab === 'confirmed' && order.payment_status !== 'paid' && (
                        <p className="text-xs mt-0.5 text-amber-600 font-medium">
                          Unpaid · Pay on delivery
                        </p>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${statusColors[order.status] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                        {formatStatus(order.status)}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-eye-line text-lg w-4 h-4 flex items-center justify-center"></i>
                        </Link>
                        <button
                          onClick={() => openReceipt(order.id)}
                          title="View / print receipt"
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <i className="ri-printer-line text-lg w-4 h-4 flex items-center justify-center"></i>
                        </button>
                        {orderViewTab === 'abandoned' && order.payment_status !== 'paid' && (
                          <button
                            onClick={() => handleResendPaymentLink(order)}
                            disabled={sendingPaymentLink === order.id}
                            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title="Resend payment link"
                          >
                            {sendingPaymentLink === order.id ? (
                              <i className="ri-loader-4-line animate-spin text-lg w-4 h-4 flex items-center justify-center"></i>
                            ) : (
                              <i className="ri-send-plane-line text-lg w-4 h-4 flex items-center justify-center"></i>
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </AdminTableScroll>

        {filteredOrders.length > 0 && (
          <div className="p-6 border-t border-gray-200 flex items-center justify-between">
            <p className="text-gray-600">Showing {filteredOrders.length} of {tabOrders.length} orders</p>
          </div>
        )}
      </div>
      </>
      )}

      <ProductSalesStats isOpen={showProductStats} onClose={() => setShowProductStats(false)} />

      {/* ── Receipt preview / print modal (renders in-page via an iframe — no
            pop-up windows, isolated styling, prints reliably on mobile) ── */}
      {receiptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <i className="ri-receipt-line text-xl text-blue-600 shrink-0"></i>
                <div className="min-w-0">
                  <h2 className="font-bold text-gray-900 text-base leading-tight truncate">{receiptTitle}</h2>
                  {receiptCount > 1 && (
                    <p className="text-xs text-gray-500">{receiptCount} receipts · one per page</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={printReceiptIframe}
                  disabled={receiptLoading || !receiptDocHtml}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer"
                >
                  <i className="ri-printer-line"></i>
                  Print
                </button>
                <button
                  onClick={closeReceiptModal}
                  className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded-lg cursor-pointer"
                  aria-label="Close"
                >
                  <i className="ri-close-line text-xl"></i>
                </button>
              </div>
            </div>

            <div className="flex-1 bg-gray-100 overflow-hidden relative">
              {receiptLoading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                  <i className="ri-loader-4-line animate-spin text-3xl mb-2"></i>
                  <p className="text-sm">Loading receipt…</p>
                </div>
              ) : receiptError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 text-red-600">
                  <i className="ri-error-warning-line text-4xl mb-2"></i>
                  <p className="font-semibold">Couldn&apos;t load the receipt</p>
                  <p className="text-sm text-gray-500 mt-1">{receiptError}</p>
                </div>
              ) : (
                <iframe
                  srcDoc={receiptDocHtml}
                  title="Receipt preview"
                  className="w-full h-full border-0 bg-gray-100"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
