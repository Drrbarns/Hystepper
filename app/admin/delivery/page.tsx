'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import AdminTableScroll from '@/components/admin/AdminTableScroll';

interface Rider {
  user_id: string;
  full_name: string;
  email: string;
  is_active: boolean;
}

interface Order {
  id: string;
  order_number: string;
  status: string;
  total: number;
  created_at: string;
  rider_id: string | null;
  assigned_at: string | null;
  rider_notes: string | null;
  phone: string | null;
  shipping_address: any;
  profiles?: { full_name: string; email: string } | null;
  order_items?: { quantity: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  pending:         'bg-amber-100 text-amber-700 border-amber-200',
  processing:      'bg-blue-100 text-blue-700 border-blue-200',
  shipped:         'bg-purple-100 text-purple-700 border-purple-200',
  delivered:       'bg-emerald-100 text-emerald-700 border-emerald-200',
  completed:       'bg-emerald-100 text-emerald-700 border-emerald-200',
  returned:        'bg-orange-100 text-orange-800 border-orange-200',
  cancelled:       'bg-red-100 text-red-700 border-red-200',
  awaiting_payment:'bg-gray-100 text-gray-600 border-gray-200',
};

const ASSIGNABLE_STATUSES = ['pending', 'processing', 'shipped'];

export default function DeliveryPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [tab, setTab] = useState<'unassigned' | 'assigned' | 'done'>('unassigned');
  const [search, setSearch] = useState('');
  const [riderFilter, setRiderFilter] = useState('all');
  const [noteModal, setNoteModal] = useState<{ orderId: string; note: string } | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [ordersRes, ridersRes] = await Promise.all([
        supabase
          .from('orders')
          .select(`
            id, order_number, status, total, created_at,
            rider_id, assigned_at, rider_notes, phone, shipping_address,
            order_items(quantity)
          `)
          .not('status', 'in', '(cancelled,awaiting_payment,refunded)')
          .order('created_at', { ascending: false }),
        supabase
          .from('staff')
          .select('user_id, full_name, email, is_active')
          .eq('role', 'rider')
          .eq('is_active', true),
      ]);

      setOrders(ordersRes.data || []);
      setRiders(ridersRes.data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const assignRider = async (orderId: string, riderId: string | null) => {
    setAssigning(orderId);
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          rider_id: riderId || null,
          assigned_at: riderId ? new Date().toISOString() : null,
          status: riderId ? 'shipped' : 'processing',
        })
        .eq('id', orderId);

      if (error) throw error;

      setOrders(prev =>
        prev.map(o =>
          o.id === orderId
            ? { ...o, rider_id: riderId, assigned_at: riderId ? new Date().toISOString() : null, status: riderId ? 'shipped' : 'processing' }
            : o
        )
      );
      showToast(riderId ? 'Rider assigned successfully' : 'Rider unassigned');
    } catch (err: any) {
      showToast(err.message || 'Failed to assign rider', 'error');
    } finally {
      setAssigning(null);
    }
  };

  const saveNote = async () => {
    if (!noteModal) return;
    const { error } = await supabase
      .from('orders')
      .update({ rider_notes: noteModal.note })
      .eq('id', noteModal.orderId);
    if (!error) {
      setOrders(prev => prev.map(o => o.id === noteModal.orderId ? { ...o, rider_notes: noteModal.note } : o));
      showToast('Note saved');
    }
    setNoteModal(null);
  };

  const getCustomerName = (o: Order) =>
    o.shipping_address?.full_name || o.profiles?.full_name || o.shipping_address?.firstName
      ? `${o.shipping_address?.firstName || ''} ${o.shipping_address?.lastName || ''}`.trim()
      : 'Guest';

  const getItemCount = (o: Order) =>
    o.order_items?.reduce((s, i) => s + i.quantity, 0) ?? 0;

  const getRiderName = (riderId: string | null) =>
    riders.find(r => r.user_id === riderId)?.full_name || '—';

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // Stats
  const unassignedCount = orders.filter(o => !o.rider_id && ASSIGNABLE_STATUSES.includes(o.status)).length;
  const doneStatuses = ['delivered', 'completed', 'returned'];
  const assignedCount   = orders.filter((o) => o.rider_id && !doneStatuses.includes(o.status)).length;
  const doneCount       = orders.filter((o) => doneStatuses.includes(o.status)).length;

  // Filter
  const filtered = orders.filter(o => {
    const name = getCustomerName(o).toLowerCase();
    const num  = (o.order_number || o.id).toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase()) || num.includes(search.toLowerCase());
    const matchRider  = riderFilter === 'all' || o.rider_id === riderFilter;

    if (tab === 'unassigned') return !o.rider_id && ASSIGNABLE_STATUSES.includes(o.status) && matchSearch;
    if (tab === 'assigned')   return !!o.rider_id && !doneStatuses.includes(o.status) && matchSearch && matchRider;
    if (tab === 'done')       return doneStatuses.includes(o.status) && matchSearch && matchRider;
    return false;
  });

  return (
    <div className="space-y-6">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 transition-all ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          <i className={`${toast.type === 'success' ? 'ri-check-line' : 'ri-error-warning-line'} text-base`}></i>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Delivery Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">Assign orders to riders and track deliveries</p>
        </div>
        <button
          onClick={fetchData}
          className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
        >
          <i className="ri-refresh-line"></i> Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Unassigned', count: unassignedCount, icon: 'ri-inbox-unarchive-line', color: 'amber', tab: 'unassigned' as const },
          { label: 'Out for Delivery', count: assignedCount, icon: 'ri-truck-line', color: 'blue', tab: 'assigned' as const },
          { label: 'Delivered', count: doneCount, icon: 'ri-checkbox-circle-line', color: 'emerald', tab: 'done' as const },
        ].map(s => (
          <button
            key={s.tab}
            onClick={() => setTab(s.tab)}
            className={`p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${
              tab === s.tab ? `border-${s.color}-400 bg-${s.color}-50` : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
              tab === s.tab ? `bg-${s.color}-100 text-${s.color}-600` : 'bg-gray-100 text-gray-500'
            }`}>
              <i className={`${s.icon} text-xl`}></i>
            </div>
            <p className="text-2xl font-bold text-gray-900">{s.count}</p>
            <p className="text-sm text-gray-500">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
          <input
            type="text"
            placeholder="Search by order # or customer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
        {(tab === 'assigned' || tab === 'done') && (
          <select
            value={riderFilter}
            onChange={e => setRiderFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="all">All Riders</option>
            {riders.map(r => (
              <option key={r.user_id} value={r.user_id}>{r.full_name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Orders table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <i className="ri-loader-4-line animate-spin text-2xl mr-2"></i> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <i className="ri-truck-line text-5xl mb-3 block opacity-30"></i>
            <p className="font-medium">
              {tab === 'unassigned' ? 'No unassigned orders' :
               tab === 'assigned'   ? 'No orders out for delivery' :
                                      'No delivered orders'}
            </p>
          </div>
        ) : (
          <AdminTableScroll>
            <table className="w-full min-w-[54rem] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="px-5 py-3">Order</th>
                  <th className="px-5 py-3">Customer</th>
                  <th className="px-5 py-3">Address</th>
                  <th className="px-5 py-3">Items</th>
                  <th className="px-5 py-3">Total</th>
                  <th className="px-5 py-3">Status</th>
                  {tab !== 'unassigned' && <th className="px-5 py-3">Rider</th>}
                  {tab !== 'unassigned' && <th className="px-5 py-3">Assigned</th>}
                  <th className="px-5 py-3">Assign Rider</th>
                  <th className="px-5 py-3">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(order => (
                  <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="font-semibold text-blue-600 hover:text-blue-800"
                      >
                        {order.order_number || order.id.substring(0, 8)}
                      </Link>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(order.created_at)}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-900">{getCustomerName(order)}</p>
                      <p className="text-xs text-gray-400">{order.phone || '—'}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-gray-700 max-w-[200px] leading-snug">
                        {order.shipping_address?.address || order.shipping_address?.deliveryArea || '—'}
                      </p>
                      {order.shipping_address?.region && (
                        <p className="text-xs text-gray-400">{order.shipping_address.region}</p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-center text-gray-700">{getItemCount(order)}</td>
                    <td className="px-5 py-4 font-semibold text-gray-900 whitespace-nowrap">
                      GH₵ {order.total?.toFixed(2)}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                        {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                      </span>
                    </td>
                    {tab !== 'unassigned' && (
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                            {getRiderName(order.rider_id).charAt(0).toUpperCase()}
                          </div>
                          <span className="text-gray-700 text-sm">{getRiderName(order.rider_id)}</span>
                        </div>
                      </td>
                    )}
                    {tab !== 'unassigned' && (
                      <td className="px-5 py-4 text-xs text-gray-400 whitespace-nowrap">
                        {order.assigned_at ? formatDate(order.assigned_at) : '—'}
                      </td>
                    )}
                    <td className="px-5 py-4">
                      {doneStatuses.includes(order.status) ? (
                        order.status === 'returned' ? (
                          <span className="text-xs text-orange-600 font-medium flex items-center gap-1">
                            <i className="ri-arrow-go-back-line"></i> Returned
                          </span>
                        ) : (
                        <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                          <i className="ri-check-double-line"></i> Done
                        </span>
                        )
                      ) : (
                        <div className="flex items-center gap-2">
                          <select
                            value={order.rider_id || ''}
                            onChange={e => assignRider(order.id, e.target.value || null)}
                            disabled={assigning === order.id}
                            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300 min-w-[130px] cursor-pointer"
                          >
                            <option value="">— Unassigned —</option>
                            {riders.map(r => (
                              <option key={r.user_id} value={r.user_id}>{r.full_name}</option>
                            ))}
                          </select>
                          {assigning === order.id && (
                            <i className="ri-loader-4-line animate-spin text-blue-500"></i>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => setNoteModal({ orderId: order.id, note: order.rider_notes || '' })}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                          order.rider_notes
                            ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                        }`}
                        title={order.rider_notes || 'Add delivery note'}
                      >
                        <i className="ri-sticky-note-line"></i>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableScroll>
        )}
        {filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 text-sm text-gray-500">
            Showing {filtered.length} order{filtered.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Rider load summary (assigned tab) */}
      {tab === 'assigned' && riders.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Rider Load</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {riders.map(rider => {
              const active = orders.filter(
                (o) => o.rider_id === rider.user_id && !doneStatuses.includes(o.status) && o.status !== 'cancelled'
              ).length;
              return (
                <div key={rider.user_id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">
                  <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm shrink-0">
                    {rider.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{rider.full_name}</p>
                    <p className="text-xs text-gray-500">{active} active order{active !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Note modal */}
      {noteModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="font-semibold text-gray-900 mb-3">Delivery Note</h3>
            <textarea
              value={noteModal.note}
              onChange={e => setNoteModal({ ...noteModal, note: e.target.value })}
              placeholder="e.g. Leave at gate, call customer on arrival…"
              rows={4}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={saveNote}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors cursor-pointer"
              >
                Save Note
              </button>
              <button
                onClick={() => setNoteModal(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
