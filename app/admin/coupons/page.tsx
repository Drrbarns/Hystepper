'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import AdminTableScroll from '@/components/admin/AdminTableScroll';
import { toast } from 'sonner';

const EMPTY_FORM = {
  code: '',
  type: 'percentage' as 'percentage' | 'fixed_amount',
  value: '',
  minimum_purchase: '',
  maximum_discount: '',
  usage_limit: '',
  start_date: new Date().toISOString().split('T')[0],
  end_date: '',
  is_active: true,
  description: '',
};

export default function AdminCouponsPage() {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [coupons, setCoupons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => { fetchCoupons(); }, []);

  const fetchCoupons = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('coupons')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (data) setCoupons(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getCouponStatus = (c: any) => {
    if (!c.is_active) return 'Disabled';
    if (c.end_date && new Date(c.end_date) < new Date()) return 'Expired';
    if (c.start_date && new Date(c.start_date) > new Date()) return 'Scheduled';
    return 'Active';
  };

  const statusColors: Record<string, string> = {
    Active: 'bg-emerald-100 text-emerald-700',
    Scheduled: 'bg-blue-100 text-blue-700',
    Expired: 'bg-gray-100 text-gray-700',
    Disabled: 'bg-red-100 text-red-700',
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const openEdit = (c: any) => {
    setEditingId(c.id);
    setForm({
      code: c.code || '',
      type: c.type || 'percentage',
      value: c.value?.toString() || '',
      minimum_purchase: c.minimum_purchase?.toString() || '',
      maximum_discount: c.maximum_discount?.toString() || '',
      usage_limit: c.usage_limit?.toString() || '',
      start_date: c.start_date ? new Date(c.start_date).toISOString().split('T')[0] : '',
      end_date: c.end_date ? new Date(c.end_date).toISOString().split('T')[0] : '',
      is_active: c.is_active ?? true,
      description: c.description || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.code.trim()) { toast.error('Coupon code is required'); return; }
    if (!form.value || parseFloat(form.value) <= 0) { toast.error('Discount value is required'); return; }

    setSaving(true);
    try {
      const payload = {
        code: form.code.toUpperCase().trim(),
        type: form.type,
        value: parseFloat(form.value),
        minimum_purchase: form.minimum_purchase ? parseFloat(form.minimum_purchase) : null,
        maximum_discount: form.maximum_discount ? parseFloat(form.maximum_discount) : null,
        usage_limit: form.usage_limit ? parseInt(form.usage_limit) : null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        is_active: form.is_active,
        description: form.description || null,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error } = await supabase.from('coupons').update(payload).eq('id', editingId);
        if (error) throw error;
        toast.success('Coupon updated');
      } else {
        const { error } = await supabase.from('coupons').insert(payload);
        if (error) throw error;
        toast.success('Coupon created');
      }

      setShowModal(false);
      fetchCoupons();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save coupon');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this coupon permanently?')) return;
    const { error } = await supabase.from('coupons').delete().eq('id', id);
    if (error) { toast.error('Failed to delete'); return; }
    toast.success('Coupon deleted');
    fetchCoupons();
  };

  const handleToggleActive = async (c: any) => {
    const { error } = await supabase.from('coupons').update({ is_active: !c.is_active }).eq('id', c.id);
    if (error) { toast.error('Failed to update'); return; }
    fetchCoupons();
  };

  const displayCoupons = coupons.filter(c => {
    if (statusFilter === 'all') return true;
    return getCouponStatus(c).toLowerCase() === statusFilter;
  });

  const activeCoupons = coupons.filter(c => getCouponStatus(c) === 'Active');
  const totalUses = coupons.reduce((sum, c) => sum + (c.usage_count || 0), 0);
  const totalDiscountGiven = coupons.reduce((sum, c) => sum + ((c.usage_count || 0) * (c.value || 0)), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Coupons & Promotions</h1>
          <p className="text-gray-600 mt-1 text-sm sm:text-base">Create and manage discount codes</p>
        </div>
        <button onClick={openCreate} className="bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 sm:px-6 sm:py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer self-start sm:self-auto text-sm sm:text-base">
          <i className="ri-add-line mr-2"></i>Create Coupon
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Coupons</p>
          <p className="text-2xl font-bold text-gray-900">{coupons.length}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Active</p>
          <p className="text-2xl font-bold text-emerald-700">{activeCoupons.length}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Uses</p>
          <p className="text-2xl font-bold text-gray-900">{totalUses}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Discount</p>
          <p className="text-2xl font-bold text-purple-700">GH₵{totalDiscountGiven.toFixed(0)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">All Coupons</h2>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-medium cursor-pointer">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="scheduled">Scheduled</option>
              <option value="expired">Expired</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        </div>

        <AdminTableScroll>
          <table className="w-full min-w-[48rem]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-4 px-6 text-sm font-semibold text-gray-700">Code</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Type</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Value</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Min Purchase</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Usage</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Valid Period</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-500">Loading coupons...</td></tr>
              ) : displayCoupons.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-gray-500">No coupons found.</td></tr>
              ) : displayCoupons.map((c) => {
                const status = getCouponStatus(c);
                return (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-gray-900 bg-gray-100 px-3 py-1 rounded">{c.code}</span>
                        <button onClick={() => { navigator.clipboard.writeText(c.code); toast.success('Copied!'); }} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors cursor-pointer">
                          <i className="ri-file-copy-line"></i>
                        </button>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-gray-700 capitalize">{c.type?.replace('_', ' ')}</td>
                    <td className="py-4 px-4 font-semibold text-gray-900">
                      {c.type === 'percentage' ? `${c.value}%` : `GH₵${c.value}`}
                    </td>
                    <td className="py-4 px-4 text-gray-700 whitespace-nowrap">
                      {c.minimum_purchase ? `GH₵${Number(c.minimum_purchase).toFixed(0)}` : 'None'}
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-gray-900 font-semibold">{c.usage_count || 0}</span>
                      <span className="text-gray-500"> / </span>
                      <span className="text-gray-600">{c.usage_limit || '∞'}</span>
                    </td>
                    <td className="py-4 px-4">
                      <p className="text-sm text-gray-700 whitespace-nowrap">{c.start_date ? new Date(c.start_date).toLocaleDateString() : '—'}</p>
                      <p className="text-sm text-gray-500 whitespace-nowrap">{c.end_date ? new Date(c.end_date).toLocaleDateString() : 'No expiry'}</p>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusColors[status] || 'bg-gray-100'}`}>{status}</span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-1">
                        <button onClick={() => handleToggleActive(c)} className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${c.is_active ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`} title={c.is_active ? 'Disable' : 'Enable'}>
                          <i className={c.is_active ? 'ri-pause-circle-line text-lg' : 'ri-play-circle-line text-lg'}></i>
                        </button>
                        <button onClick={() => openEdit(c)} className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer">
                          <i className="ri-edit-line text-lg"></i>
                        </button>
                        <button onClick={() => handleDelete(c.id)} className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer">
                          <i className="ri-delete-bin-line text-lg"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminTableScroll>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">{editingId ? 'Edit Coupon' : 'Create Coupon'}</h2>
                <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"><i className="ri-close-line text-xl"></i></button>
              </div>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-1">Coupon Code *</label>
                <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-mono uppercase" placeholder="e.g. SAVE20" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-1">Description</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" placeholder="e.g. 20% off for new customers" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1">Discount Type *</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })} className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 cursor-pointer">
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed_amount">Fixed Amount (GH₵)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1">Value *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">{form.type === 'percentage' ? '%' : 'GH₵'}</span>
                    <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="w-full pl-12 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" step="0.01" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1">Min Purchase (GH₵)</label>
                  <input type="number" value={form.minimum_purchase} onChange={(e) => setForm({ ...form, minimum_purchase: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" placeholder="0" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1">Max Discount (GH₵)</label>
                  <input type="number" value={form.maximum_discount} onChange={(e) => setForm({ ...form, maximum_discount: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" placeholder="No limit" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-1">Usage Limit</label>
                <input type="number" value={form.usage_limit} onChange={(e) => setForm({ ...form, usage_limit: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" placeholder="Unlimited" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1">Start Date</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 cursor-pointer" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-1">End Date</label>
                  <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 cursor-pointer" />
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <button type="button" onClick={() => setForm({ ...form, is_active: !form.is_active })} className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${form.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${form.is_active ? 'translate-x-6' : 'translate-x-0'}`}></span>
                </button>
                <span className="text-sm font-medium text-gray-700">Active immediately</span>
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 font-semibold transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-6 py-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold transition-colors disabled:opacity-50">
                {saving ? 'Saving...' : editingId ? 'Update Coupon' : 'Create Coupon'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
