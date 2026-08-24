'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { adminAuthHeaders } from '@/lib/admin-auth-headers';

type TopProduct = { name: string; units: number; revenue: number };

type MonthStats = {
  orderCount: number;
  revenue: number;
  deliveredCount: number;
  newCustomers: number;
  products: Map<string, TopProduct>;
};

type Insight = {
  tone: 'up' | 'down' | 'info' | 'action';
  text: string;
};

function getMonthRange(monthsAgo: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 0, 23, 59, 59, 999);
  const label = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return { start, end, label };
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

function formatPct(value: number | null): string {
  if (value === null) return 'new';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

const EMPTY_STATS: MonthStats = {
  orderCount: 0,
  revenue: 0,
  deliveredCount: 0,
  newCustomers: 0,
  products: new Map(),
};

export default function MonthlyReportPage() {
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<MonthStats>(EMPTY_STATS);
  const [previous, setPrevious] = useState<MonthStats>(EMPTY_STATS);
  const [ga4Configured, setGa4Configured] = useState(true);
  const [staffEmail, setStaffEmail] = useState<string | null>(null);

  const range = useMemo(() => getMonthRange(1), []);
  const prevRange = useMemo(() => getMonthRange(2), []);

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMonthStats(start: Date, end: Date): Promise<MonthStats> {
    const isoStart = start.toISOString();
    const isoEnd = end.toISOString();

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

    const { count: customerCount, error: customerError } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', isoStart)
      .lte('created_at', isoEnd);

    if (customerError) throw customerError;

    const orderIds = paidOrPos.map((o) => o.id);
    const products = new Map<string, TopProduct>();

    for (let i = 0; i < orderIds.length; i += 100) {
      const chunk = orderIds.slice(i, i + 100);
      const { data: items } = await supabase
        .from('order_items')
        .select('quantity, total_price, product_name, status')
        .in('order_id', chunk);

      (items || []).forEach((it) => {
        if (it.status && it.status !== 'active') return;
        const name = it.product_name || 'Unknown';
        const existing = products.get(name) || { name, units: 0, revenue: 0 };
        products.set(name, {
          name,
          units: existing.units + Number(it.quantity || 0),
          revenue: existing.revenue + Number(it.total_price || 0),
        });
      });
    }

    return {
      orderCount: paidOrPos.length,
      revenue: paidOrPos.reduce((sum, o) => sum + orderNet(o), 0),
      deliveredCount: paidOrPos.filter((o) => o.status === 'delivered').length,
      newCustomers: customerCount || 0,
      products,
    };
  }

  const loadReport = async () => {
    try {
      setLoading(true);

      const { data: { session } } = await supabase.auth.getSession();
      setStaffEmail(session?.user?.email || null);

      const [cur, prev] = await Promise.all([
        loadMonthStats(range.start, range.end),
        loadMonthStats(prevRange.start, prevRange.end),
      ]);
      setCurrent(cur);
      setPrevious(prev);

      const { data: ga4Row } = await supabase
        .from('store_settings')
        .select('value')
        .eq('key', 'ga4_measurement_id')
        .maybeSingle();
      const ga4Value = typeof ga4Row?.value === 'string' ? ga4Row.value : '';
      setGa4Configured(ga4Value.trim().length > 0);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load monthly report');
    } finally {
      setLoading(false);
    }
  };

  const topProducts = useMemo(
    () => [...current.products.values()].sort((a, b) => b.units - a.units).slice(0, 10),
    [current]
  );

  const aov = current.orderCount > 0 ? current.revenue / current.orderCount : 0;
  const prevAov = previous.orderCount > 0 ? previous.revenue / previous.orderCount : 0;

  const deltas = useMemo(() => ({
    revenue: pctChange(current.revenue, previous.revenue),
    orders: pctChange(current.orderCount, previous.orderCount),
    customers: pctChange(current.newCustomers, previous.newCustomers),
    aov: pctChange(aov, prevAov),
  }), [current, previous, aov, prevAov]);

  const insights = useMemo<Insight[]>(() => {
    const list: Insight[] = [];
    const hasPrevData = previous.orderCount > 0 || previous.revenue > 0;

    // --- Sales trend ---
    if (hasPrevData) {
      if (deltas.revenue !== null && deltas.revenue !== 0) {
        list.push({
          tone: deltas.revenue > 0 ? 'up' : 'down',
          text: `Revenue ${deltas.revenue > 0 ? 'increased' : 'decreased'} by ${Math.abs(deltas.revenue).toFixed(1)}% vs ${prevRange.label} (GH₵${previous.revenue.toFixed(2)} → GH₵${current.revenue.toFixed(2)}).`,
        });
      }
      if (deltas.orders !== null && deltas.orders !== 0) {
        list.push({
          tone: deltas.orders > 0 ? 'up' : 'down',
          text: `Orders ${deltas.orders > 0 ? 'increased' : 'decreased'} by ${Math.abs(deltas.orders).toFixed(1)}% (${previous.orderCount} → ${current.orderCount}).`,
        });
      }
      if (deltas.customers !== null && deltas.customers !== 0) {
        list.push({
          tone: deltas.customers > 0 ? 'up' : 'down',
          text: `Customer acquisition ${deltas.customers > 0 ? 'increased' : 'decreased'} by ${Math.abs(deltas.customers).toFixed(1)}% (${previous.newCustomers} → ${current.newCustomers} new customers).`,
        });
      }
      if (deltas.aov !== null && Math.abs(deltas.aov) >= 5) {
        list.push({
          tone: deltas.aov > 0 ? 'up' : 'down',
          text: `Average order value ${deltas.aov > 0 ? 'rose' : 'fell'} ${Math.abs(deltas.aov).toFixed(1)}% to GH₵${aov.toFixed(2)}.${deltas.aov < 0 ? ' Consider bundles or free-delivery thresholds to lift basket size.' : ''}`,
        });
      }
    } else {
      list.push({ tone: 'info', text: `No sales recorded in ${prevRange.label}, so month-over-month comparisons will start next month.` });
    }

    // --- Product movers ---
    const risers: string[] = [];
    const decliners: string[] = [];
    current.products.forEach((p) => {
      const prevUnits = previous.products.get(p.name)?.units || 0;
      if (prevUnits > 0 && p.units > prevUnits) risers.push(`${p.name} (${prevUnits} → ${p.units} sold)`);
    });
    previous.products.forEach((p) => {
      const curUnits = current.products.get(p.name)?.units || 0;
      if (p.units >= 2 && curUnits < p.units) decliners.push(`${p.name} (${p.units} → ${curUnits} sold)`);
    });

    risers.slice(0, 3).forEach((r) => list.push({ tone: 'up', text: `${r} is performing better than last month.` }));
    if (decliners.length > 0) {
      list.push({
        tone: 'action',
        text: `Sales slowed for: ${decliners.slice(0, 3).join(', ')}. Consider promoting these (feature on the homepage, add to a bundle, or run a discount).`,
      });
    }

    // --- Fulfilment ---
    if (current.orderCount > 0) {
      const deliveredRate = (current.deliveredCount / current.orderCount) * 100;
      if (deliveredRate < 80) {
        list.push({
          tone: 'action',
          text: `Only ${deliveredRate.toFixed(0)}% of paid orders were marked delivered. Review pending orders and update statuses — review-request emails only go out after delivery.`,
        });
      } else {
        list.push({ tone: 'up', text: `${deliveredRate.toFixed(0)}% of paid orders were delivered.` });
      }
    }

    // --- Promotion ideas from top sellers ---
    if (topProducts.length > 0) {
      list.push({
        tone: 'info',
        text: `"${topProducts[0].name}" was your best seller (${topProducts[0].units} sold). Keep it in stock and consider pairing slower products with it as a bundle.`,
      });
    }

    // --- Conversion rate ---
    if (!ga4Configured) {
      list.push({
        tone: 'action',
        text: 'Conversion rate needs Google Analytics: add your GA4 Measurement ID under Settings → Tracking & Pixels, then visitor-to-purchase conversion appears in Google Analytics.',
      });
    } else {
      list.push({
        tone: 'info',
        text: 'Conversion rate: open Google Analytics → Reports → Monetisation to see visitor-to-purchase conversion for this period.',
      });
    }

    return list;
  }, [current, previous, deltas, aov, topProducts, ga4Configured, prevRange.label]);

  const summaryText = useMemo(() => {
    const lines = [
      `Hy_stepper Monthly Report — ${range.label}`,
      '',
      `Orders: ${current.orderCount} (${formatPct(deltas.orders)} vs ${prevRange.label})`,
      `Revenue (excl. delivery fees): GH₵${current.revenue.toFixed(2)} (${formatPct(deltas.revenue)})`,
      `Average order value: GH₵${aov.toFixed(2)} (${formatPct(deltas.aov)})`,
      `Delivered orders: ${current.deliveredCount}`,
      `New customers: ${current.newCustomers} (${formatPct(deltas.customers)})`,
      '',
      'Top products:',
      ...(topProducts.length
        ? topProducts.map((p, i) => `${i + 1}. ${p.name} — ${p.units} sold, GH₵${p.revenue.toFixed(2)}`)
        : ['(no product sales recorded)']),
      '',
      'Insights & recommendations:',
      ...insights.map((ins) => `- ${ins.text}`),
    ];
    return lines.join('\n');
  }, [range.label, prevRange.label, current, deltas, aov, topProducts, insights]);

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

  const toneStyles: Record<Insight['tone'], { icon: string; classes: string }> = {
    up: { icon: 'ri-arrow-up-circle-line', classes: 'bg-emerald-50 border-emerald-100 text-emerald-800' },
    down: { icon: 'ri-arrow-down-circle-line', classes: 'bg-red-50 border-red-100 text-red-800' },
    action: { icon: 'ri-lightbulb-flash-line', classes: 'bg-amber-50 border-amber-100 text-amber-800' },
    info: { icon: 'ri-information-line', classes: 'bg-blue-50 border-blue-100 text-blue-800' },
  };

  const statCards = [
    { label: 'Orders', value: current.orderCount.toString(), delta: deltas.orders, icon: 'ri-shopping-bag-line' },
    { label: 'Revenue', value: `GH₵${current.revenue.toFixed(2)}`, delta: deltas.revenue, icon: 'ri-money-dollar-circle-line' },
    { label: 'Avg Order Value', value: `GH₵${aov.toFixed(2)}`, delta: deltas.aov, icon: 'ri-price-tag-3-line' },
    { label: 'New Customers', value: current.newCustomers.toString(), delta: deltas.customers, icon: 'ri-user-add-line' },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8 print:space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 print:block">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Monthly Optimisation Report</h1>
          <p className="text-gray-600 mt-2">{range.label} — compared with {prevRange.label}</p>
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
            {statCards.map((card) => (
              <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                    <i className={`${card.icon} text-xl`}></i>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-gray-500">{card.label}</p>
                    <p className="text-xl font-bold text-gray-900 truncate">{card.value}</p>
                    {card.delta !== null && card.delta !== 0 && (
                      <p className={`text-xs font-semibold ${card.delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatPct(card.delta)} vs last month
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              <i className="ri-lightbulb-flash-line text-amber-500 mr-2"></i>
              Insights &amp; Recommendations
            </h2>
            {insights.length === 0 ? (
              <p className="text-gray-500 text-sm">Not enough data yet — insights appear once there are sales in two consecutive months.</p>
            ) : (
              <ul className="space-y-3">
                {insights.map((ins, idx) => {
                  const style = toneStyles[ins.tone];
                  return (
                    <li key={idx} className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${style.classes}`}>
                      <i className={`${style.icon} text-lg shrink-0 mt-0.5`}></i>
                      <span>{ins.text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Top Products</h2>
            {topProducts.length === 0 ? (
              <p className="text-gray-500 text-sm">No product sales in this period.</p>
            ) : (
              <ol className="space-y-3">
                {topProducts.map((p, idx) => {
                  const prevUnits = previous.products.get(p.name)?.units || 0;
                  return (
                    <li key={p.name} className="flex justify-between gap-4 border-b border-gray-100 pb-2 last:border-0">
                      <span className="font-medium text-gray-900">{idx + 1}. {p.name}</span>
                      <span className="text-sm text-gray-600 shrink-0">
                        {p.units} sold · GH₵{p.revenue.toFixed(2)}
                        {prevUnits > 0 && (
                          <span className={p.units >= prevUnits ? 'text-emerald-600' : 'text-red-600'}>
                            {' '}({prevUnits} last month)
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
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
