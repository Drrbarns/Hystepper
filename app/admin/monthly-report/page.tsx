'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { adminAuthHeaders } from '@/lib/admin-auth-headers';

type TopProduct = { name: string; units: number; revenue: number };

function getLastCalendarMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const label = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return { start, end, label };
}

export default function MonthlyReportPage() {
  const [loading, setLoading] = useState(true);
  const [orderCount, setOrderCount] = useState(0);
  const [revenue, setRevenue] = useState(0);
  const [deliveredCount, setDeliveredCount] = useState(0);
  const [newCustomers, setNewCustomers] = useState(0);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [staffEmail, setStaffEmail] = useState<string | null>(null);

  const range = useMemo(() => getLastCalendarMonthRange(), []);

  useEffect(() => {
    loadReport();
  }, []);

  const loadReport = async () => {
    try {
      setLoading(true);
      const isoStart = range.start.toISOString();
      const isoEnd = range.end.toISOString();

      const { data: { session } } = await supabase.auth.getSession();
      setStaffEmail(session?.user?.email || null);

      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id, total, shipping_total, status, payment_status, created_at, metadata')
        .gte('created_at', isoStart)
        .lte('created_at', isoEnd);

      if (ordersError) throw ordersError;

      const paidOrPos = (orders || []).filter(
        (o) => o.payment_status === 'paid' || (o.metadata as Record<string, unknown> | null)?.pos_sale === true
      );

      const orderNet = (o: { total?: number; shipping_total?: number }) =>
        Math.max(0, Number(o.total || 0) - Number(o.shipping_total || 0));

      setOrderCount(paidOrPos.length);
      setRevenue(paidOrPos.reduce((sum, o) => sum + orderNet(o), 0));
      setDeliveredCount(paidOrPos.filter((o) => o.status === 'delivered').length);

      const { count: customerCount, error: customerError } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', isoStart)
        .lte('created_at', isoEnd);

      if (customerError) throw customerError;
      setNewCustomers(customerCount || 0);

      const orderIds = paidOrPos.map((o) => o.id);
      const productMap = new Map<string, TopProduct>();

      for (let i = 0; i < orderIds.length; i += 100) {
        const chunk = orderIds.slice(i, i + 100);
        const { data: items } = await supabase
          .from('order_items')
          .select('quantity, total_price, product_name, status')
          .in('order_id', chunk);

        (items || []).forEach((it) => {
          if (it.status && it.status !== 'active') return;
          const name = it.product_name || 'Unknown';
          const existing = productMap.get(name) || { name, units: 0, revenue: 0 };
          existing.units += Number(it.quantity || 0);
          existing.revenue += Number(it.total_price || 0);
          productMap.set(name, existing);
        });
      }

      setTopProducts(
        [...productMap.values()].sort((a, b) => b.units - a.units).slice(0, 10)
      );
    } catch (err) {
      console.error(err);
      toast.error('Failed to load monthly report');
    } finally {
      setLoading(false);
    }
  };

  const summaryText = useMemo(() => {
    const lines = [
      `Hy_stepper Monthly Report — ${range.label}`,
      '',
      `Orders: ${orderCount}`,
      `Revenue (excl. delivery fees): GH₵${revenue.toFixed(2)}`,
      `Delivered orders: ${deliveredCount}`,
      `New customers: ${newCustomers}`,
      '',
      'Top products:',
      ...(topProducts.length
        ? topProducts.map((p, i) => `${i + 1}. ${p.name} — ${p.units} sold, GH₵${p.revenue.toFixed(2)}`)
        : ['(no product sales recorded)']),
    ];
    return lines.join('\n');
  }, [range.label, orderCount, revenue, deliveredCount, newCustomers, topProducts]);

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      toast.success('Summary copied to clipboard');
    } catch {
      toast.error('Could not copy — select and copy manually');
    }
  };

  const emailSummary = async () => {
    if (!staffEmail) {
      toast.error('No staff email on session');
      return;
    }
    try {
      const headers = await adminAuthHeaders();
      const res = await fetch('/api/admin/monthly-report/email', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          subject: `Hy_stepper Monthly Report — ${range.label}`,
          summary: summaryText,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Email failed');
      toast.success('Report emailed to you');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Email failed');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 print:space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 print:block">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Monthly Optimisation Report</h1>
          <p className="text-gray-600 mt-2">{range.label}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button
            type="button"
            onClick={copySummary}
            className="border border-gray-300 hover:bg-gray-50 font-semibold px-4 py-2 rounded-lg"
          >
            Copy Summary
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="border border-gray-300 hover:bg-gray-50 font-semibold px-4 py-2 rounded-lg"
          >
            Print
          </button>
          {staffEmail && (
            <button
              type="button"
              onClick={emailSummary}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded-lg"
            >
              Email to Me
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading report…</p>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Orders', value: orderCount.toString(), icon: 'ri-shopping-bag-line' },
              { label: 'Revenue', value: `GH₵${revenue.toFixed(2)}`, icon: 'ri-money-dollar-circle-line' },
              { label: 'Delivered', value: deliveredCount.toString(), icon: 'ri-truck-line' },
              { label: 'New Customers', value: newCustomers.toString(), icon: 'ri-user-add-line' },
            ].map((card) => (
              <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <i className={`${card.icon} text-xl`}></i>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">{card.label}</p>
                    <p className="text-xl font-bold text-gray-900">{card.value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Top Products</h2>
            {topProducts.length === 0 ? (
              <p className="text-gray-500 text-sm">No product sales in this period.</p>
            ) : (
              <ol className="space-y-3">
                {topProducts.map((p, idx) => (
                  <li key={p.name} className="flex justify-between gap-4 border-b border-gray-100 pb-2 last:border-0">
                    <span className="font-medium text-gray-900">{idx + 1}. {p.name}</span>
                    <span className="text-sm text-gray-600 shrink-0">
                      {p.units} sold · GH₵{p.revenue.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 print:border-0 print:bg-white">
            <h2 className="text-lg font-bold text-gray-900 mb-3">Executive Summary</h2>
            <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono leading-relaxed">{summaryText}</pre>
          </div>
        </>
      )}
    </div>
  );
}
