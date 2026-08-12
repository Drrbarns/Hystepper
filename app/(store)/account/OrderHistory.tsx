'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useCart } from '@/context/CartContext';
import { toast } from 'sonner';

interface OrderItem {
  /** order_items row id (React key only) */
  lineId: string;
  /** products.id — required by the cart */
  productId: string;
  variantId?: string;
  name: string;
  image: string;
  quantity: number;
  price: number;
  slug: string;
  sku?: string;
  size?: string;
  color?: string;
  variant?: string;
}

interface Order {
  id: string;
  orderNumber: string;
  date: string;
  status: string;
  total: number;
  items: OrderItem[];
}

export default function OrderHistory() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const { addToCart } = useCart();

  useEffect(() => {
    async function fetchOrders() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const { data, error } = await supabase
          .from('orders')
          .select(`
                    *,
                    order_items (*)
                `)
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;

        if (data) {
          const formattedOrders = data.map((order) => ({
            id: order.id,
            orderNumber: order.order_number,
            date: order.created_at,
            status: order.status,
            total: order.total,
            items: (order.order_items || []).map((item: any) => {
              const meta = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
              const productId = item.product_id || '';
              const variantId = item.variant_id || meta.variant_id || undefined;
              return {
                lineId: item.id,
                productId,
                variantId: variantId || undefined,
                name: item.product_name || 'Product',
                image: meta.image || '/placeholder-product.png',
                quantity: Number(item.quantity) || 1,
                price: Number(item.unit_price) || 0,
                slug: meta.slug || productId,
                sku: item.sku || undefined,
                size: meta.size || undefined,
                color: meta.color || undefined,
                variant: item.variant_name || undefined,
              } as OrderItem;
            }),
          }));
          setOrders(formattedOrders);
        }
      } catch (err) {
        console.error('Error fetching orders:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchOrders();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'delivered':
      case 'completed':
        return 'bg-green-100 text-green-700';
      case 'shipped':
      case 'packaging_for_delivery':
        return 'bg-blue-100 text-blue-700';
      case 'packed':
        return 'bg-indigo-100 text-indigo-700';
      case 'processing':
        return 'bg-yellow-100 text-yellow-700';
      case 'cancelled':
      case 'refunded':
        return 'bg-red-100 text-red-700';
      case 'returned':
        return 'bg-orange-100 text-orange-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const handleReorder = async (order: Order) => {
    if (reorderingId) return;
    setReorderingId(order.id);

    try {
      const productIds = Array.from(
        new Set(order.items.map((i) => i.productId).filter(Boolean))
      );
      const variantIds = Array.from(
        new Set(order.items.map((i) => i.variantId).filter((v): v is string => !!v))
      );

      if (productIds.length === 0) {
        toast.error('No products found on this order to reorder');
        return;
      }

      const [productsRes, variantsRes] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, slug, price, status, quantity, product_images(url, position)')
          .in('id', productIds),
        variantIds.length > 0
          ? supabase
              .from('product_variants')
              .select('id, product_id, quantity, sku, option1, option2, name, image_url')
              .in('id', variantIds)
          : Promise.resolve({ data: [] as any[], error: null }),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (variantsRes.error) throw variantsRes.error;

      const productMap = new Map((productsRes.data || []).map((p: any) => [p.id, p]));
      const variantMap = new Map((variantsRes.data || []).map((v: any) => [v.id, v]));

      let added = 0;
      const skipped: string[] = [];

      for (const item of order.items) {
        if (!item.productId) {
          skipped.push(item.name);
          continue;
        }

        const product = productMap.get(item.productId);
        if (!product || product.status !== 'active') {
          skipped.push(item.name);
          continue;
        }

        let availableStock = Number(product.quantity) || 0;
        let variantSku: string | undefined;
        let variantImage: string | undefined;
        let size = item.size;
        let color = item.color;
        let variantLabel = item.variant;

        if (item.variantId) {
          const variant = variantMap.get(item.variantId);
          if (!variant) {
            skipped.push(`${item.name}${item.variant ? ` (${item.variant})` : ''}`);
            continue;
          }
          availableStock = Number(variant.quantity) || 0;
          variantSku = variant.sku || undefined;
          variantImage = variant.image_url || undefined;
          if (!size && variant.option1) size = String(variant.option1);
          if (!color && variant.option2) color = String(variant.option2);
          if (!variantLabel) {
            variantLabel = [size, color].filter(Boolean).join(' / ') || variant.name || undefined;
          }
        }

        if (availableStock <= 0) {
          skipped.push(`${item.name}${variantLabel ? ` (${variantLabel})` : ''}`);
          continue;
        }

        const images = Array.isArray(product.product_images) ? product.product_images : [];
        const sortedImages = [...images].sort(
          (a: any, b: any) => (Number(a.position) || 0) - (Number(b.position) || 0)
        );
        const liveImage =
          variantImage ||
          sortedImages[0]?.url ||
          item.image ||
          '/placeholder-product.png';

        const qty = Math.min(Math.max(1, item.quantity), availableStock);

        addToCart({
          id: item.productId,
          name: product.name || item.name,
          price: Number(product.price) || item.price,
          image: liveImage,
          quantity: qty,
          slug: product.slug || item.slug || item.productId,
          maxStock: availableStock,
          sku: variantSku || item.sku,
          variantId: item.variantId,
          variant: variantLabel,
          size,
          color,
        });
        added++;
      }

      if (added > 0) {
        toast.success(`${added} item${added === 1 ? '' : 's'} added to cart`);
      }
      if (skipped.length > 0) {
        const summary = skipped.slice(0, 2).join(', ');
        const more = skipped.length > 2 ? ` +${skipped.length - 2} more` : '';
        toast.info(
          added > 0
            ? `Skipped unavailable: ${summary}${more}`
            : `Nothing could be reordered — unavailable: ${summary}${more}`
        );
      }
      if (added === 0 && skipped.length === 0) {
        toast.error('Could not add items to cart');
      }
    } catch (err) {
      console.error('Reorder failed:', err);
      toast.error('Failed to reorder — please try again');
    } finally {
      setReorderingId(null);
    }
  };

  const handleDownloadInvoice = async (order: Order) => {
    const invoiceWindow = window.open('', '_blank');
    if (!invoiceWindow) {
      toast.error('Please allow popups to download invoices');
      return;
    }

    const itemsHtml = order.items.map((item) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.name}${item.variant ? ` (${item.variant})` : ''}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">GH₵ ${item.price.toFixed(2)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">GH₵ ${(item.price * item.quantity).toFixed(2)}</td>
      </tr>
    `).join('');

    invoiceWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice - ${order.orderNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #333; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
          .logo { font-size: 24px; font-weight: bold; color: #047857; }
          .invoice-title { font-size: 28px; font-weight: bold; color: #333; text-align: right; }
          .invoice-meta { text-align: right; font-size: 14px; color: #666; margin-top: 8px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background: #f3f4f6; padding: 10px 8px; text-align: left; font-weight: 600; }
          .totals { text-align: right; margin-top: 20px; }
          .totals td { padding: 4px 0; }
          .total-row { font-size: 18px; font-weight: bold; border-top: 2px solid #333; padding-top: 8px; }
          .footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="logo">Hy_stepper</div>
            <p style="font-size: 14px; color: #666; margin-top: 4px;">Premium Footwear</p>
          </div>
          <div>
            <div class="invoice-title">INVOICE</div>
            <div class="invoice-meta">
              <p><strong>Order:</strong> ${order.orderNumber}</p>
              <p><strong>Date:</strong> ${new Date(order.date).toLocaleDateString()}</p>
              <p><strong>Status:</strong> ${order.status}</p>
            </div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th style="text-align: center;">Qty</th>
              <th style="text-align: right;">Unit Price</th>
              <th style="text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <table class="totals" style="width: 300px; margin-left: auto;">
          <tr>
            <td>Subtotal:</td>
            <td style="text-align: right;">GH₵ ${order.items.reduce((s, i) => s + i.price * i.quantity, 0).toFixed(2)}</td>
          </tr>
          <tr class="total-row">
            <td>Total:</td>
            <td style="text-align: right;">GH₵ ${order.total.toFixed(2)}</td>
          </tr>
        </table>

        <div class="footer">
          <p>Thank you for shopping with Hy_stepper!</p>
          <p>For questions, contact us on WhatsApp or Instagram</p>
        </div>

        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `);
    invoiceWindow.document.close();
  };

  if (loading) {
    return (
      <div className="py-8 text-center">
        <i className="ri-loader-4-line animate-spin text-3xl text-gold-600"></i>
        <p className="mt-2 text-gray-500">Loading orders...</p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="py-12 text-center bg-white rounded-lg border border-gray-200">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="ri-shopping-bag-line text-3xl text-gray-400"></i>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">No orders yet</h3>
        <p className="text-gray-500 mb-6">Start shopping to see your orders here.</p>
        <Link href="/shop" className="inline-block bg-gold-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-gold-700 transition-colors">
          Go to Shop
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Order History</h2>
        <div className="text-sm text-gray-600">
          Total Orders: <span className="font-bold text-gray-900">{orders.length}</span>
        </div>
      </div>

      <div className="space-y-6">
        {orders.map((order) => (
          <div key={order.id} className="bg-white border-2 border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-6">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Order Number</p>
                    <p className="font-bold text-gray-900">{order.orderNumber}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Date</p>
                    <p className="font-semibold text-gray-900">
                      {new Date(order.date).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Total</p>
                    <p className="font-bold text-gold-700">GH₵{order.total.toFixed(2)}</p>
                  </div>
                </div>
                <div>
                  <span className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap capitalize ${getStatusColor(order.status)}`}>
                    {order.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-6">
              <div className="space-y-4 mb-4">
                {order.items.map((item) => (
                  <div key={item.lineId} className="flex space-x-4">
                    <div className="w-20 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 border border-gray-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.image || '/placeholder-product.png'}
                        alt={item.name}
                        className="w-full h-full object-cover object-center"
                        loading="lazy"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 mb-1">{item.name}</h4>
                      {item.variant && (
                        <p className="text-sm text-gray-500">{item.variant}</p>
                      )}
                      <p className="text-sm text-gray-600">Quantity: {item.quantity}</p>
                      <p className="text-sm font-bold text-gray-900 mt-1">GH₵{item.price.toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-200">
                <button
                  onClick={() => handleReorder(order)}
                  disabled={reorderingId === order.id}
                  className="px-4 py-2 border-2 border-gray-300 text-gray-900 rounded-lg font-semibold hover:bg-gray-50 transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <i className={`${reorderingId === order.id ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} mr-2`}></i>
                  {reorderingId === order.id ? 'Adding…' : 'Reorder'}
                </button>
                <button
                  onClick={() => handleDownloadInvoice(order)}
                  className="px-4 py-2 border-2 border-gray-300 text-gray-900 rounded-lg font-semibold hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  <i className="ri-download-line mr-2"></i>
                  Invoice
                </button>
                <Link
                  href="/contact"
                  className="px-4 py-2 border-2 border-gray-300 text-gray-900 rounded-lg font-semibold hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  <i className="ri-customer-service-line mr-2"></i>
                  Get Help
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
