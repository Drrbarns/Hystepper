'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { compareSizes } from '@/lib/sort-sizes';
import AdminTableScroll from '@/components/admin/AdminTableScroll';

type Period = 'today' | '7d' | '30d' | 'all';

type LineAgg = {
  color: string;
  size: string;
  qty: number;
  orderCount: number;
  orderNumbers: string[];
};

type CodeGroup = {
  productCode: string;
  styleName: string;
  productName: string;
  totalPairs: number;
  lines: LineAgg[];
};

const looksLikeSize = (v: string) =>
  /^\d{1,2}(\.\d)?$/.test(v) || /^(xs|s|m|l|xl|xxl|xxxl)$/i.test(v);

function resolveVariantSizeColor(item: any): { size: string; color: string } {
  const clean = (v: any) => (v == null ? '' : String(v).trim());

  const variant = item?.variant || null;
  if (variant) {
    const nameParts = clean(variant.name).split('/').map((p: string) => p.trim()).filter(Boolean);
    const colorFromVariant = clean(variant.option2) || (nameParts.length > 1 ? nameParts[1] : '');
    let sizeFromVariant = clean(variant.option1);
    if (!sizeFromVariant && nameParts.length > 1) sizeFromVariant = nameParts[0];
    if (!sizeFromVariant && nameParts.length === 1 && looksLikeSize(nameParts[0])) {
      sizeFromVariant = nameParts[0];
    }
    if (sizeFromVariant || colorFromVariant) {
      return { size: sizeFromVariant, color: colorFromVariant };
    }
  }

  const labelParts = clean(item?.variant_name).split('/').map((p: string) => p.trim()).filter(Boolean);
  if (labelParts.length > 1) {
    return { size: labelParts[0], color: labelParts[1] };
  }

  const meta = item?.metadata || {};
  const metaSize = clean(meta.size);
  const metaColor = clean(meta.color);
  if (metaColor || (metaSize && looksLikeSize(metaSize))) {
    return { size: looksLikeSize(metaSize) ? metaSize : '', color: metaColor };
  }

  const lone = labelParts[0] || metaSize;
  if (lone) {
    return looksLikeSize(lone) ? { size: lone, color: '' } : { size: '', color: lone };
  }
  return { size: '', color: '' };
}

function isConfirmedOrder(order: any): boolean {
  if (order?.payment_status === 'paid') return true;
  const meta = (order?.metadata || {}) as Record<string, unknown>;
  return meta.pos_sale === true;
}

function startOfPeriod(period: Period): string | null {
  if (period === 'all') return null;
  const now = new Date();
  if (period === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const d = new Date(now);
  d.setDate(d.getDate() - (period === '7d' ? 7 : 30));
  return d.toISOString();
}

function buildPrintHtml(groups: CodeGroup[], periodLabel: string): string {
  const esc = (s: any) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const sections = groups
    .map((g) => {
      const rows = g.lines
        .map(
          (l) => `
          <tr>
            <td>${esc(l.color || '—')}</td>
            <td>${esc(l.size || '—')}</td>
            <td class="qty">${esc(l.qty)}</td>
            <td class="muted">${esc(l.orderCount)} order${l.orderCount === 1 ? '' : 's'}</td>
          </tr>`,
        )
        .join('');
      return `
        <section class="code-block">
          <h2>${esc(g.productCode)}${g.styleName ? ` <span class="style">· ${esc(g.styleName)}</span>` : ''}</h2>
          <p class="sub">${esc(g.productName || '')} · <strong>${esc(g.totalPairs)}</strong> pairs total</p>
          <table>
            <thead><tr><th>Color</th><th>Size</th><th>Pairs</th><th>Orders</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>`;
    })
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Packing List</title>
    <style>
      @page { margin: 12mm; }
      body { font-family: system-ui, -apple-system, sans-serif; color: #111; margin: 0; padding: 16px; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      .meta { color: #555; font-size: 13px; margin-bottom: 20px; }
      .code-block { break-inside: avoid; margin-bottom: 22px; padding-bottom: 12px; border-bottom: 1px solid #ddd; }
      h2 { font-size: 16px; margin: 0 0 2px; }
      .style { font-weight: 500; color: #444; font-size: 14px; }
      .sub { font-size: 12px; color: #555; margin: 0 0 8px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #eee; }
      th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; }
      .qty { font-weight: 700; font-size: 15px; }
      .muted { color: #777; font-size: 12px; }
      @media print { body { padding: 0; } .no-print { display: none; } }
    </style></head><body>
    <h1>Hy_stepper Packing List</h1>
    <p class="meta">${esc(periodLabel)} · Generated ${esc(new Date().toLocaleString())}</p>
    ${sections || '<p>No items to pack for this filter.</p>'}
    <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); }</script>
    </body></html>`;
}

export default function PackingList() {
  const [period, setPeriod] = useState<Period>('today');
  const [includeShipped, setIncludeShipped] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState<CodeGroup[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const statuses = includeShipped
        ? ['pending', 'processing', 'shipped']
        : ['pending', 'processing'];

      let query = supabase
        .from('order_items')
        .select(`
          id, quantity, status, sku, variant_name, metadata, product_name, product_id,
          products ( product_code, sku, style_name, name ),
          variant:product_variants ( name, option1, option2, sku ),
          orders!inner (
            id, order_number, status, payment_status, created_at, metadata
          )
        `)
        .or('status.eq.active,status.is.null')
        .in('orders.status', statuses);

      const from = startOfPeriod(period);
      if (from) query = query.gte('orders.created_at', from);

      const { data, error: qErr } = await query;
      if (qErr) throw qErr;

      type AccLine = LineAgg & { _orders: Set<string> };
      type AccCode = {
        productCode: string;
        styleName: string;
        productName: string;
        lines: Map<string, AccLine>;
      };

      const byCode = new Map<string, AccCode>();

      for (const item of data || []) {
        const order = (item as any).orders;
        if (!order || !isConfirmedOrder(order)) continue;
        if (item.status && item.status !== 'active') continue;

        const product = (item as any).products || {};
        const code =
          String(product.product_code || product.sku || '').trim() ||
          String(item.product_name || item.product_id || 'NO-CODE').trim();

        const { size, color } = resolveVariantSizeColor(item);
        const sizeKey = size || '—';
        const colorKey = color || '—';
        const lineKey = `${colorKey.toLowerCase()}::${sizeKey.toLowerCase()}`;

        if (!byCode.has(code)) {
          byCode.set(code, {
            productCode: code,
            styleName: String(product.style_name || '').trim(),
            productName: String(product.name || item.product_name || '').trim(),
            lines: new Map(),
          });
        }
        const group = byCode.get(code)!;
        if (!group.lines.has(lineKey)) {
          group.lines.set(lineKey, {
            color: colorKey,
            size: sizeKey,
            qty: 0,
            orderCount: 0,
            orderNumbers: [],
            _orders: new Set(),
          });
        }
        const line = group.lines.get(lineKey)!;
        line.qty += Number(item.quantity) || 0;
        const on = String(order.order_number || order.id);
        if (!line._orders.has(order.id)) {
          line._orders.add(order.id);
          line.orderCount += 1;
          line.orderNumbers.push(on);
        }
      }

      const next: CodeGroup[] = Array.from(byCode.values())
        .map((g) => {
          const lines = Array.from(g.lines.values())
            .map(({ _orders, ...rest }) => rest)
            .sort((a, b) => {
              const c = a.color.localeCompare(b.color, undefined, { sensitivity: 'base' });
              if (c !== 0) return c;
              return compareSizes(a.size, b.size);
            });
          return {
            productCode: g.productCode,
            styleName: g.styleName,
            productName: g.productName,
            totalPairs: lines.reduce((s, l) => s + l.qty, 0),
            lines,
          };
        })
        .sort((a, b) => a.productCode.localeCompare(b.productCode, undefined, { numeric: true }));

      setGroups(next);
      setExpanded(new Set(next.map((g) => g.productCode)));
    } catch (err: any) {
      console.error('Packing list error:', err);
      setError(err?.message || 'Failed to load packing list');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [period, includeShipped]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.productCode.toLowerCase().includes(q) ||
        g.styleName.toLowerCase().includes(q) ||
        g.productName.toLowerCase().includes(q) ||
        g.lines.some(
          (l) =>
            l.color.toLowerCase().includes(q) ||
            l.size.toLowerCase().includes(q),
        ),
    );
  }, [groups, search]);

  const totalPairs = filtered.reduce((s, g) => s + g.totalPairs, 0);
  const totalSkus = filtered.reduce((s, g) => s + g.lines.length, 0);

  const periodLabel =
    period === 'today'
      ? 'Today'
      : period === '7d'
        ? 'Last 7 days'
        : period === '30d'
          ? 'Last 30 days'
          : 'All open orders';

  const toggleExpand = (code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleExportCsv = () => {
    const header = ['Product Code', 'Style', 'Product', 'Color', 'Size', 'Pairs', 'Orders'];
    const rows = filtered.flatMap((g) =>
      g.lines.map((l) => [
        g.productCode,
        g.styleName,
        g.productName,
        l.color,
        l.size,
        String(l.qty),
        String(l.orderCount),
      ]),
    );
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `packing-list-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    const html = buildPrintHtml(filtered, periodLabel);
    const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1000');
    if (!w) {
      setError('Pop-up blocked — allow pop-ups to print the packing list.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="space-y-4">
      <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 text-violet-900 text-sm">
        <p className="font-semibold mb-1">
          <i className="ri-box-3-line mr-1"></i>
          Packing List
        </p>
        <p>
          Confirmed orders grouped by <strong>product code → color → size</strong> so you can pull
          everything for one style from the shelf in one trip.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {([
              ['today', 'Today'],
              ['7d', '7 days'],
              ['30d', '30 days'],
              ['all', 'All open'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPeriod(id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                  period === id
                    ? 'bg-violet-700 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
            <label className="ml-1 inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeShipped}
                onChange={(e) => setIncludeShipped(e.target.checked)}
                className="rounded border-gray-300 text-violet-700 focus:ring-violet-500"
              />
              Include shipped
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchList()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-800 disabled:opacity-50 cursor-pointer"
            >
              <i className={`ri-refresh-line ${loading ? 'animate-spin' : ''}`}></i>
              Refresh
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-50 cursor-pointer"
            >
              <i className="ri-download-line"></i>
              CSV
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-violet-700 hover:bg-violet-800 text-white disabled:opacity-50 cursor-pointer"
            >
              <i className="ri-printer-line"></i>
              Print
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="relative flex-1 max-w-md">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, color, size…"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-400 focus:border-violet-400"
            />
          </div>
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{filtered.length}</span> styles ·{' '}
            <span className="font-semibold text-gray-900">{totalSkus}</span> color/size lines ·{' '}
            <span className="font-semibold text-violet-800">{totalPairs}</span> pairs
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
            {error}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">
            <i className="ri-loader-4-line animate-spin text-2xl text-violet-600"></i>
            <p className="mt-2 text-sm">Building packing list…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <i className="ri-inbox-line text-3xl text-gray-300"></i>
            <p className="mt-2 font-medium text-gray-700">Nothing to pack</p>
            <p className="text-sm mt-1">No confirmed open orders match this filter.</p>
          </div>
        ) : (
          <AdminTableScroll>
            <div className="divide-y divide-gray-100 min-w-[640px]">
              {filtered.map((g) => {
                const open = expanded.has(g.productCode);
                return (
                  <div key={g.productCode}>
                    <button
                      type="button"
                      onClick={() => toggleExpand(g.productCode)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-violet-50/60 transition-colors cursor-pointer"
                    >
                      <i
                        className={`ri-arrow-${open ? 'down' : 'right'}-s-line text-lg text-violet-700`}
                      ></i>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-900 text-base tracking-wide">
                          {g.productCode}
                          {g.styleName ? (
                            <span className="ml-2 font-medium text-gray-500 text-sm">
                              {g.styleName}
                            </span>
                          ) : null}
                        </p>
                        {g.productName ? (
                          <p className="text-xs text-gray-500 truncate">{g.productName}</p>
                        ) : null}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-violet-800">{g.totalPairs}</p>
                        <p className="text-xs text-gray-500">
                          pairs · {g.lines.length} line{g.lines.length === 1 ? '' : 's'}
                        </p>
                      </div>
                    </button>

                    {open && (
                      <div className="bg-gray-50/80 border-t border-gray-100 px-4 pb-3">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                              <th className="py-2 pl-8 font-semibold">Color</th>
                              <th className="py-2 font-semibold">Size</th>
                              <th className="py-2 font-semibold text-right">Pairs</th>
                              <th className="py-2 pr-2 font-semibold text-right">Orders</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.lines.map((l) => (
                              <tr
                                key={`${l.color}-${l.size}`}
                                className="border-t border-gray-100/80"
                              >
                                <td className="py-2 pl-8 font-medium text-gray-900">{l.color}</td>
                                <td className="py-2 font-semibold text-gray-800">{l.size}</td>
                                <td className="py-2 text-right text-base font-bold text-violet-800">
                                  {l.qty}
                                </td>
                                <td
                                  className="py-2 pr-2 text-right text-gray-500"
                                  title={l.orderNumbers.join(', ')}
                                >
                                  {l.orderCount}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </AdminTableScroll>
        )}
      </div>
    </div>
  );
}
