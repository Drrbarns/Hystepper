'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import AdminTableScroll from '@/components/admin/AdminTableScroll';
import { adminAuthHeaders } from '@/lib/admin-auth-headers';

function isConfirmedOrder(order: { payment_status?: string; metadata?: Record<string, unknown> | null }) {
  if (order.payment_status === 'paid') return true;
  return order.metadata?.pos_sale === true;
}

export default function AbandonedCartAdminPage() {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [moduleEnabled, setModuleEnabled] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [delayHours, setDelayHours] = useState(2);
  const [lastRun, setLastRun] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      const [{ data: moduleRow }, { data: settingsRows }, { data: orderRows }] = await Promise.all([
        supabase.from('store_modules').select('enabled').eq('id', 'abandoned-cart').maybeSingle(),
        supabase
          .from('store_settings')
          .select('key, value')
          .in('key', ['abandoned_cart_enabled', 'abandoned_cart_delay_hours', 'abandoned_cart_last_run']),
        supabase
          .from('orders')
          .select('id, order_number, email, phone, total, status, payment_status, created_at, metadata')
          .order('created_at', { ascending: false })
          .limit(500),
      ]);

      setModuleEnabled(!!moduleRow?.enabled);

      const settingsMap = new Map<string, unknown>();
      settingsRows?.forEach((r: { key: string; value: unknown }) => settingsMap.set(r.key, r.value));

      const settingEnabled = settingsMap.get('abandoned_cart_enabled');
      setEnabled(
        settingEnabled === true ||
          settingEnabled === 1 ||
          String(settingEnabled || '').replace(/^"+|"+$/g, '').toLowerCase() === 'true'
      );

      const delayRaw = settingsMap.get('abandoned_cart_delay_hours');
      const delayNum = Number(typeof delayRaw === 'string' ? delayRaw.replace(/^"+|"+$/g, '') : delayRaw);
      setDelayHours(Number.isFinite(delayNum) && delayNum > 0 ? delayNum : 2);

      const lr = settingsMap.get('abandoned_cart_last_run');
      setLastRun(typeof lr === 'string' ? lr : lr ? String(lr) : null);

      const abandoned = (orderRows || []).filter((o) => !isConfirmedOrder(o));
      setOrders(abandoned);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load abandoned cart data');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from('store_settings').upsert(
        [
          { key: 'abandoned_cart_enabled', value: enabled, updated_at: now },
          { key: 'abandoned_cart_delay_hours', value: Math.max(1, delayHours), updated_at: now },
        ],
        { onConflict: 'key' }
      );
      if (error) throw error;
      toast.success('Settings saved');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save settings');
    }
  };

  const runRecoveryNow = async () => {
    setRunning(true);
    try {
      const headers = await adminAuthHeaders();
      const res = await fetch('/api/cron/abandoned-cart', { headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Recovery failed');

      if (body.skipped) {
        toast.message(body.reason || 'Recovery skipped');
      } else {
        toast.success(`Recovery sent ${body.emailed || 0} email(s)`);
      }
      await loadData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Recovery failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Abandoned Cart Recovery</h1>
        <p className="text-gray-600 mt-2">
          Email customers who started checkout but did not complete payment.
        </p>
      </div>

      {!moduleEnabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 text-sm">
          The <strong>Abandoned Cart Recovery</strong> module is disabled. Enable it under{' '}
          <Link href="/admin/modules" className="underline font-semibold">Modules</Link> to activate automated recovery.
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <h2 className="text-lg font-bold text-gray-900">Recovery Settings</h2>

          <label className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-gray-700">Send recovery emails</span>
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-600' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Delay (hours after checkout)</label>
            <input
              type="number"
              min={1}
              value={delayHours}
              onChange={(e) => setDelayHours(Math.max(1, Number(e.target.value) || 2))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          {lastRun && (
            <p className="text-xs text-gray-500">Last run: {new Date(lastRun).toLocaleString()}</p>
          )}

          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              onClick={saveSettings}
              className="w-full bg-gray-900 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              Save Settings
            </button>
            <button
              type="button"
              onClick={runRecoveryNow}
              disabled={running || !moduleEnabled}
              className="w-full border border-emerald-600 text-emerald-700 hover:bg-emerald-50 font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {running ? 'Running…' : 'Run Recovery Now'}
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Unpaid / Abandoned Orders</h2>
            <span className="text-sm text-gray-500">{orders.length} orders</span>
          </div>

          {loading ? (
            <p className="text-gray-500 py-8 text-center">Loading…</p>
          ) : orders.length === 0 ? (
            <p className="text-gray-500 py-8 text-center">No abandoned orders right now.</p>
          ) : (
            <AdminTableScroll>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-4">Order</th>
                    <th className="py-2 pr-4">Customer</th>
                    <th className="py-2 pr-4">Total</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4">Emailed</th>
                    <th className="py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const emailedAt = (order.metadata as Record<string, unknown> | null)?.abandoned_cart_emailed_at;
                    return (
                      <tr key={order.id} className="border-b border-gray-100">
                        <td className="py-3 pr-4 font-medium">#{order.order_number}</td>
                        <td className="py-3 pr-4">
                          <div>{order.email || '—'}</div>
                          <div className="text-xs text-gray-500">{order.phone || ''}</div>
                        </td>
                        <td className="py-3 pr-4">GH₵{Number(order.total || 0).toFixed(2)}</td>
                        <td className="py-3 pr-4">{new Date(order.created_at).toLocaleString()}</td>
                        <td className="py-3 pr-4 text-xs">
                          {emailedAt ? new Date(String(emailedAt)).toLocaleString() : '—'}
                        </td>
                        <td className="py-3">
                          <Link href={`/admin/orders/${order.id}`} className="text-emerald-700 font-semibold hover:underline">
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </AdminTableScroll>
          )}
        </div>
      </div>
    </div>
  );
}
