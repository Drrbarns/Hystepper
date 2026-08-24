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

type BriefItem = {
  kind: 'finding' | 'action';
  title: string;
  detail: string;
  direction?: 'up' | 'down';
};

function getMonthRange(monthsAgo: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 0, 23, 59, 59, 999);
  const label = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const short = start.toLocaleDateString('en-GB', { month: 'short' });
  return { start, end, label, short };
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

function formatPct(value: number | null): string {
  if (value === null) return 'New';
  const sign = value > 0 ? '+' : '';
  return `${sign}${Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;
}

function formatMoney(n: number): string {
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < 0.005) {
    return `GH₵${rounded.toLocaleString('en-US')}`;
  }
  return `GH₵${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatInt(n: number): string {
  return n.toLocaleString('en-US');
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

  const headline = useMemo(() => {
    const hasPrev = previous.orderCount > 0 || previous.revenue > 0;
    if (!hasPrev) {
      return `${range.label} is the first month with a full comparison window.`;
    }
    const rev = deltas.revenue ?? 0;
    const ord = deltas.orders ?? 0;
    if (rev > 15 && ord < 0) {
      return 'Revenue rose on fewer orders — average basket size did the work.';
    }
    if (rev > 15 && ord > 0) {
      return 'Both revenue and order volume were ahead of the previous month.';
    }
    if (rev < -10 && ord < 0) {
      return 'Sales and volume both eased versus the previous month.';
    }
    if (Math.abs(rev) < 8 && Math.abs(ord) < 8) {
      return 'Trading was broadly in line with the previous month.';
    }
    if (rev > 0) return 'Revenue finished ahead of the previous month.';
    return 'Revenue finished behind the previous month.';
  }, [previous, deltas, range.label]);

  const brief = useMemo(() => {
    const findings: BriefItem[] = [];
    const actions: BriefItem[] = [];
    const hasPrevData = previous.orderCount > 0 || previous.revenue > 0;

    if (hasPrevData) {
      if (deltas.revenue !== null && deltas.revenue !== 0) {
        findings.push({
          kind: 'finding',
          direction: deltas.revenue > 0 ? 'up' : 'down',
          title: `Revenue ${formatPct(deltas.revenue)}`,
          detail: `${formatMoney(previous.revenue)} in ${prevRange.short} to ${formatMoney(current.revenue)} in ${range.short}.`,
        });
      }
      if (deltas.orders !== null && deltas.orders !== 0) {
        findings.push({
          kind: 'finding',
          direction: deltas.orders > 0 ? 'up' : 'down',
          title: `Orders ${formatPct(deltas.orders)}`,
          detail: `${formatInt(current.orderCount)} paid orders, versus ${formatInt(previous.orderCount)} in ${prevRange.short}.`,
        });
      }
      if (deltas.aov !== null && Math.abs(deltas.aov) >= 5) {
        findings.push({
          kind: 'finding',
          direction: deltas.aov > 0 ? 'up' : 'down',
          title: `Average order ${formatPct(deltas.aov)}`,
          detail: `${formatMoney(aov)} this month${prevAov > 0 ? `, from ${formatMoney(prevAov)}` : ''}.`,
        });
      }
      if (deltas.customers !== null && deltas.customers !== 0) {
        findings.push({
          kind: 'finding',
          direction: deltas.customers > 0 ? 'up' : 'down',
          title: `New customers ${formatPct(deltas.customers)}`,
          detail: `${formatInt(current.newCustomers)} accounts opened, versus ${formatInt(previous.newCustomers)} in ${prevRange.short}.`,
        });
      }
    }

    const risers: BriefItem[] = [];
    const decliners: string[] = [];
    current.products.forEach((p) => {
      const prevUnits = previous.products.get(p.name)?.units || 0;
      if (prevUnits > 0 && p.units > prevUnits) {
        risers.push({
          kind: 'finding',
          direction: 'up',
          title: p.name,
          detail: `${p.units} sold, up from ${prevUnits}.`,
        });
      }
    });
    previous.products.forEach((p) => {
      const curUnits = current.products.get(p.name)?.units || 0;
      if (p.units >= 2 && curUnits < p.units) {
        decliners.push(`${p.name} (${p.units} → ${curUnits})`);
      }
    });
    findings.push(...risers.slice(0, 3));

    if (decliners.length > 0) {
      actions.push({
        kind: 'action',
        title: 'Revive slowing styles',
        detail: `${decliners.slice(0, 3).join('; ')}. Feature on the homepage, pair with a top seller, or run a short discount.`,
      });
    }

    if (current.orderCount > 0) {
      const deliveredRate = (current.deliveredCount / current.orderCount) * 100;
      if (deliveredRate < 80) {
        actions.push({
          kind: 'action',
          title: 'Clear pending deliveries',
          detail: `${deliveredRate.toFixed(0)}% of paid orders are marked delivered. Review-request emails only send after delivery.`,
        });
      } else {
        findings.push({
          kind: 'finding',
          direction: 'up',
          title: 'Fulfilment on track',
          detail: `${deliveredRate.toFixed(0)}% of paid orders marked delivered.`,
        });
      }
    }

    if (topProducts.length > 0) {
      actions.push({
        kind: 'action',
        title: `Keep ${topProducts[0].name} in stock`,
        detail: `Best seller at ${topProducts[0].units} units. Pair slower lines with it as a bundle.`,
      });
    }

    if (deltas.aov !== null && deltas.aov < -5) {
      actions.push({
        kind: 'action',
        title: 'Lift basket size',
        detail: 'Try a free-delivery threshold or a two-item bundle on the product page.',
      });
    }

    if (!ga4Configured) {
      actions.push({
        kind: 'action',
        title: 'Add Google Analytics',
        detail: 'Settings → Tracking & Pixels. Conversion rate then appears in GA4 Monetisation.',
      });
    }

    return { findings, actions };
  }, [current, previous, deltas, aov, prevAov, topProducts, ga4Configured, range.short, prevRange.short]);

  const summaryText = useMemo(() => {
    const lines = [
      `Hy_stepper — ${range.label}`,
      headline,
      '',
      `Orders: ${current.orderCount} (${formatPct(deltas.orders)} vs ${prevRange.label})`,
      `Revenue (excl. delivery): ${formatMoney(current.revenue)} (${formatPct(deltas.revenue)})`,
      `Average order: ${formatMoney(aov)} (${formatPct(deltas.aov)})`,
      `Delivered: ${current.deliveredCount}`,
      `New customers: ${current.newCustomers} (${formatPct(deltas.customers)})`,
      '',
      'Top products',
      ...(topProducts.length
        ? topProducts.map((p, i) => `${i + 1}. ${p.name} — ${p.units} sold, ${formatMoney(p.revenue)}`)
        : ['(no product sales recorded)']),
      '',
      'Notes',
      ...brief.findings.map((item) => `• ${item.title} — ${item.detail}`),
      '',
      'Next steps',
      ...(brief.actions.length
        ? brief.actions.map((item, i) => `${i + 1}. ${item.title}: ${item.detail}`)
        : ['• No actions flagged this month.']),
    ];
    return lines.join('\n');
  }, [range.label, prevRange.label, headline, current, deltas, aov, topProducts, brief]);

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      toast.success('Summary copied');
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

  const maxUnits = topProducts[0]?.units || 1;
  const btnGhost =
    'inline-flex items-center gap-1.5 h-9 px-3 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors duration-150';
  const btnPrimary =
    'inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-md transition-colors duration-150';

  return (
    <div className="max-w-6xl mx-auto print:max-w-none">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between pb-6 mb-6 border-b border-gray-200">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">Monthly report</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 text-balance">{range.label}</h1>
          <p className="mt-1 text-sm text-gray-500">Compared with {prevRange.label} · paid orders, delivery fees excluded</p>
        </div>
        <div className="flex flex-wrap items-center gap-1 print:hidden">
          <button type="button" onClick={copySummary} className={btnGhost}>
            <i className="ri-file-copy-line text-base" aria-hidden />
            Copy
          </button>
          <button type="button" onClick={() => window.print()} className={btnGhost}>
            <i className="ri-printer-line text-base" aria-hidden />
            Print
          </button>
          {staffEmail && (
            <button type="button" onClick={emailSummary} className={btnPrimary}>
              <i className="ri-mail-send-line text-base" aria-hidden />
              Email
            </button>
          )}
        </div>
      </header>

      {loading ? (
        <div className="space-y-8" aria-busy="true" aria-label="Loading report">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200 border border-gray-200">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white p-5 h-28 animate-pulse" />
            ))}
          </div>
          <div className="h-24 bg-gray-100 animate-pulse rounded-sm" />
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200 border border-gray-200 mb-8">
            {[
              { label: 'Orders', value: formatInt(current.orderCount), delta: deltas.orders },
              { label: 'Revenue', value: formatMoney(current.revenue), delta: deltas.revenue },
              { label: 'Avg. order', value: formatMoney(aov), delta: deltas.aov },
              { label: 'New customers', value: formatInt(current.newCustomers), delta: deltas.customers },
            ].map((card) => (
              <div key={card.label} className="bg-white px-5 py-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-gray-400">{card.label}</p>
                <p className="mt-2 text-[1.65rem] leading-none font-semibold tabular-nums tracking-tight text-gray-900">
                  {card.value}
                </p>
                {card.delta !== null && card.delta !== 0 ? (
                  <p className={`mt-2 text-xs tabular-nums ${card.delta > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {card.delta > 0 ? '↑' : '↓'} {formatPct(card.delta)} vs {prevRange.short}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-gray-400">vs {prevRange.short}</p>
                )}
              </div>
            ))}
          </section>

          <p className="text-[15px] leading-relaxed text-gray-800 text-pretty max-w-3xl mb-8">{headline}</p>

          <div className="grid lg:grid-cols-5 gap-10 mb-10">
            <section className="lg:col-span-3">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400 mb-4">What changed</h2>
              {brief.findings.length === 0 ? (
                <p className="text-sm text-gray-500">Not enough history yet for a month-on-month read.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {brief.findings.map((item) => (
                    <li key={`${item.title}-${item.detail}`} className="py-3.5 first:pt-0">
                      <div className="flex items-baseline justify-between gap-4">
                        <p className="text-sm font-medium text-gray-900">{item.title}</p>
                        {item.direction && (
                          <span
                            className={`text-[11px] tabular-nums shrink-0 ${
                              item.direction === 'up' ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {item.direction === 'up' ? 'Up' : 'Down'}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-gray-500 text-pretty">{item.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="lg:col-span-2 lg:border-l lg:border-gray-200 lg:pl-10">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400 mb-4">Next steps</h2>
              {brief.actions.length === 0 ? (
                <p className="text-sm text-gray-500">Nothing flagged. Keep current merchandising.</p>
              ) : (
                <ol className="space-y-5">
                  {brief.actions.map((item, idx) => (
                    <li key={item.title} className="flex gap-3">
                      <span className="text-[11px] font-medium tabular-nums text-gray-400 w-4 shrink-0 pt-0.5">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.title}</p>
                        <p className="mt-0.5 text-sm text-gray-500 text-pretty">{item.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <section>
            <div className="flex items-baseline justify-between gap-4 mb-3">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">Top products</h2>
              <p className="text-xs text-gray-400">By units sold</p>
            </div>
            {topProducts.length === 0 ? (
              <p className="text-sm text-gray-500 py-6 border-t border-gray-200">No product sales in this period.</p>
            ) : (
              <div className="overflow-x-auto border-t border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-gray-400">
                      <th className="font-medium py-3 pr-3 w-8">#</th>
                      <th className="font-medium py-3 pr-4">Product</th>
                      <th className="font-medium py-3 pr-4 text-right tabular-nums">Units</th>
                      <th className="font-medium py-3 pr-4 text-right tabular-nums hidden sm:table-cell">Revenue</th>
                      <th className="font-medium py-3 text-right tabular-nums hidden md:table-cell">{prevRange.short}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((p, idx) => {
                      const prevUnits = previous.products.get(p.name)?.units || 0;
                      const width = Math.max(8, Math.round((p.units / maxUnits) * 100));
                      return (
                        <tr key={p.name} className="border-t border-gray-100">
                          <td className="py-3 pr-3 tabular-nums text-gray-400">{idx + 1}</td>
                          <td className="py-3 pr-4">
                            <p className="font-medium text-gray-900">{p.name}</p>
                            <div className="mt-1.5 h-px w-full bg-gray-100">
                              <div className="h-px bg-gray-400" style={{ width: `${width}%` }} />
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums text-gray-900">{formatInt(p.units)}</td>
                          <td className="py-3 pr-4 text-right tabular-nums text-gray-600 hidden sm:table-cell">
                            {formatMoney(p.revenue)}
                          </td>
                          <td className="py-3 text-right tabular-nums hidden md:table-cell">
                            {prevUnits > 0 ? (
                              <span className={p.units >= prevUnits ? 'text-emerald-700' : 'text-rose-700'}>
                                {p.units >= prevUnits ? '+' : ''}
                                {p.units - prevUnits}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {!ga4Configured && (
            <p className="mt-8 text-xs text-gray-400">
              Conversion rate is not on this report until a GA4 Measurement ID is saved in Settings → Tracking &amp; Pixels.
            </p>
          )}
        </>
      )}
    </div>
  );
}
