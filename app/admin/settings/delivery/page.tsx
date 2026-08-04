'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import Link from 'next/link';

interface DeliveryMethod {
    id: string;
    name: string;
    fee: number;
    description?: string;
    active: boolean;
}

interface DeliveryZone {
    id: string;
    name: string;
    base_fee: number;
    per_item_fee: number;
    transport_service: string | null;
    is_accra: boolean;
    is_active: boolean;
    free_delivery: boolean;
    discount_percent: number;
    methods: DeliveryMethod[];
}

function makeMethodId() {
    return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function DeliverySettingsPage() {
    const [loading, setLoading] = useState(true);
    const [zones, setZones] = useState<DeliveryZone[]>([]);

    // Edit/Create State
    const [isEditing, setIsEditing] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        base_fee: 0,
        per_item_fee: 0,
        transport_service: '',
        is_accra: false,
        is_active: true,
        free_delivery: false,
        discount_percent: 0,
        methods: [] as DeliveryMethod[]
    });

    useEffect(() => {
        fetchZones();
    }, []);

    async function fetchZones() {
        try {
            const { data, error } = await supabase
                .from('delivery_zones')
                .select('*')
                .order('name');

            if (error) throw error;
            setZones(data || []);
        } catch (err) {
            console.error('Error fetching zones:', err);
            toast.error('Failed to load delivery zones');
        } finally {
            setLoading(false);
        }
    }

    function handleEdit(zone: DeliveryZone) {
        setFormData({
            name: zone.name,
            base_fee: zone.base_fee,
            per_item_fee: zone.per_item_fee || 0,
            transport_service: zone.transport_service || '',
            is_accra: zone.is_accra,
            is_active: zone.is_active,
            free_delivery: !!zone.free_delivery,
            discount_percent: Number(zone.discount_percent) || 0,
            methods: Array.isArray(zone.methods)
                ? zone.methods.map((m: any) => ({
                    id: m.id || makeMethodId(),
                    name: m.name || '',
                    fee: Number(m.fee) || 0,
                    description: m.description || '',
                    active: m.active !== false,
                }))
                : []
        });
        setEditingId(zone.id);
        setIsEditing(true);
    }

    function handleAddNew() {
        setFormData({
            name: '',
            base_fee: 0,
            per_item_fee: 0,
            transport_service: '',
            is_accra: false,
            is_active: true,
            free_delivery: false,
            discount_percent: 0,
            methods: []
        });
        setEditingId(null);
        setIsEditing(true);
    }

    async function handleSave() {
        if (!formData.name) return toast.error('Region Name is required');

        try {
            const payload = {
                name: formData.name,
                base_fee: formData.base_fee,
                per_item_fee: formData.per_item_fee,
                transport_service: formData.transport_service || null,
                is_accra: formData.is_accra,
                is_active: formData.is_active,
                free_delivery: formData.free_delivery,
                discount_percent: Math.min(100, Math.max(0, formData.discount_percent || 0)),
                methods: formData.methods
                    .filter(m => m.name.trim())
                    .map(m => ({
                        id: m.id,
                        name: m.name.trim(),
                        fee: Number(m.fee) || 0,
                        description: (m.description || '').trim() || undefined,
                        active: m.active !== false,
                    })),
                updated_at: new Date().toISOString()
            };

            if (editingId) {
                const { error } = await supabase
                    .from('delivery_zones')
                    .update(payload)
                    .eq('id', editingId);
                if (error) throw error;
                toast.success('Zone updated');
            } else {
                const { error } = await supabase
                    .from('delivery_zones')
                    .insert(payload);
                if (error) throw error;
                toast.success('Zone added');
            }

            setIsEditing(false);
            fetchZones();

        } catch (err) {
            console.error('Error saving zone:', err);
            toast.error('Failed to save zone');
        }
    }

    async function handleDelete(id: string) {
        if (!confirm('Are you sure you want to delete this zone?')) return;

        try {
            const { error } = await supabase.from('delivery_zones').delete().eq('id', id);
            if (error) throw error;
            toast.success('Zone deleted');
            fetchZones();
        } catch (err) {
            toast.error('Failed to delete zone');
        }
    }

    if (loading) return <div className="p-8">Loading delivery settings...</div>;

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <Link href="/admin/settings" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                        <i className="ri-arrow-left-line text-xl"></i>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Delivery Zones</h1>
                        <p className="text-gray-600">Manage shipping regions, fees, and transport services</p>
                    </div>
                </div>
                <button
                    onClick={handleAddNew}
                    className="px-6 py-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold transition-colors flex items-center"
                >
                    <i className="ri-add-line mr-2"></i>
                    Add New Zone
                </button>
            </div>

            {isEditing && (
                <div className="bg-white rounded-xl shadow p-6 border border-emerald-100 mb-6">
                    <h2 className="font-bold text-lg mb-4">{editingId ? 'Edit Zone' : 'New Delivery Zone'}</h2>
                    <div className="grid md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-semibold mb-2">Region Name</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                className="w-full px-4 py-2 border rounded-lg focus:ring-emerald-500"
                                placeholder="e.g. Greater Accra"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold mb-2">Base Delivery Fee (GH₵)</label>
                            <input
                                type="number"
                                value={formData.base_fee}
                                onChange={e => setFormData({ ...formData, base_fee: parseFloat(e.target.value) || 0 })}
                                className="w-full px-4 py-2 border rounded-lg focus:ring-emerald-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold mb-2">Per-Item Fee (GH₵) <span className="text-gray-500 font-normal">(for outside Accra)</span></label>
                            <input
                                type="number"
                                value={formData.per_item_fee}
                                onChange={e => setFormData({ ...formData, per_item_fee: parseFloat(e.target.value) || 0 })}
                                className="w-full px-4 py-2 border rounded-lg focus:ring-emerald-500"
                                placeholder="Extra fee per additional item"
                            />
                            <p className="text-xs text-gray-500 mt-1">Total = base_fee + (per_item_fee x number_of_items). Set to 0 for Accra zones.</p>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold mb-2">Transport Service <span className="text-gray-500 font-normal">(for outside Accra)</span></label>
                            <input
                                type="text"
                                value={formData.transport_service}
                                onChange={e => setFormData({ ...formData, transport_service: e.target.value })}
                                className="w-full px-4 py-2 border rounded-lg focus:ring-emerald-500"
                                placeholder="e.g. VIP / STC"
                            />
                            <p className="text-xs text-gray-500 mt-1">The bus or transport service used for this region</p>
                        </div>
                        <div className="flex items-center space-x-4 pt-4">
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.is_accra}
                                    onChange={e => setFormData({ ...formData, is_accra: e.target.checked })}
                                    className="w-5 h-5 text-emerald-600 rounded"
                                />
                                <span className="font-medium">Is Inside Accra?</span>
                            </label>

                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.is_active}
                                    onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
                                    className="w-5 h-5 text-emerald-600 rounded"
                                />
                                <span className="font-medium">Active</span>
                            </label>
                        </div>
                    </div>

                    {/* ── Fee adjustments ── */}
                    <div className="mt-6 pt-6 border-t border-gray-100">
                        <h3 className="font-bold text-gray-900 mb-1">Fee Adjustments</h3>
                        <p className="text-sm text-gray-500 mb-4">
                          Waive or discount the delivery fee for this location — applies to every method and to the base fee.
                          Delivery discounts do not combine with coupons, Sleek Points, or store-wide sale promotions
                          (sale items in the cart alone are fine).
                        </p>
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="p-4 bg-gray-50 rounded-lg border border-gray-100 flex items-center justify-between">
                                <div>
                                    <p className="font-medium text-gray-900">Free delivery</p>
                                    <p className="text-sm text-gray-500">Customers in this zone pay GH₵ 0.00 for delivery.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, free_delivery: !formData.free_delivery })}
                                    className={`relative w-12 h-6 rounded-full transition-colors duration-200 shrink-0 ${formData.free_delivery ? 'bg-emerald-500' : 'bg-gray-300'}`}
                                >
                                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${formData.free_delivery ? 'translate-x-6' : 'translate-x-0'}`}></span>
                                </button>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold mb-2">Delivery Fee Discount (%)</label>
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    disabled={formData.free_delivery}
                                    value={formData.discount_percent}
                                    onChange={e => setFormData({ ...formData, discount_percent: parseFloat(e.target.value) || 0 })}
                                    className="w-full px-4 py-2 border rounded-lg focus:ring-emerald-500 disabled:opacity-50 disabled:bg-gray-100"
                                />
                                <p className="text-xs text-gray-500 mt-1">e.g. 50 = customers pay half the delivery fee. Ignored when free delivery is on.</p>
                            </div>
                        </div>
                    </div>

                    {/* ── Delivery methods ── */}
                    <div className="mt-6 pt-6 border-t border-gray-100">
                        <h3 className="font-bold text-gray-900 mb-1">Delivery Methods <span className="text-gray-400 font-normal text-sm">(optional)</span></h3>
                        <p className="text-sm text-gray-500 mb-4">
                            Add the delivery options customers in this zone can choose at checkout (e.g. VIP, OA, Doorstep / FedEx),
                            each with its own fee. If none are added, the standard base-fee formula is used instead.
                        </p>
                        <div className="space-y-3">
                            {formData.methods.map((m, mi) => (
                                <div key={m.id} className="flex flex-wrap items-center gap-3 bg-gray-50 rounded-xl border border-gray-200 p-3">
                                    <input
                                        type="text"
                                        value={m.name}
                                        onChange={e => setFormData({
                                            ...formData,
                                            methods: formData.methods.map((x, i) => i === mi ? { ...x, name: e.target.value } : x)
                                        })}
                                        placeholder="Method name — e.g. VIP"
                                        className="flex-1 min-w-[140px] px-3 py-2 border rounded-lg focus:ring-emerald-500 bg-white"
                                    />
                                    <input
                                        type="text"
                                        value={m.description || ''}
                                        onChange={e => setFormData({
                                            ...formData,
                                            methods: formData.methods.map((x, i) => i === mi ? { ...x, description: e.target.value } : x)
                                        })}
                                        placeholder="Note shown to customer (optional)"
                                        className="flex-1 min-w-[180px] px-3 py-2 border rounded-lg focus:ring-emerald-500 bg-white"
                                    />
                                    <div className="flex items-center gap-1">
                                        <span className="text-sm text-gray-500">GH₵</span>
                                        <input
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            value={m.fee}
                                            onChange={e => setFormData({
                                                ...formData,
                                                methods: formData.methods.map((x, i) => i === mi ? { ...x, fee: parseFloat(e.target.value) || 0 } : x)
                                            })}
                                            className="w-24 px-3 py-2 border rounded-lg focus:ring-emerald-500 bg-white"
                                        />
                                    </div>
                                    <label className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-600">
                                        <input
                                            type="checkbox"
                                            checked={m.active}
                                            onChange={e => setFormData({
                                                ...formData,
                                                methods: formData.methods.map((x, i) => i === mi ? { ...x, active: e.target.checked } : x)
                                            })}
                                            className="w-4 h-4 text-emerald-600 rounded"
                                        />
                                        Visible
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => setFormData({
                                            ...formData,
                                            methods: formData.methods.filter((_, i) => i !== mi)
                                        })}
                                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 hover:text-red-600 text-gray-400 transition-colors"
                                    >
                                        <i className="ri-delete-bin-line"></i>
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={() => setFormData({
                                    ...formData,
                                    methods: [...formData.methods, { id: makeMethodId(), name: '', fee: 0, description: '', active: true }]
                                })}
                                className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-emerald-400 hover:text-emerald-600 transition-colors text-sm flex items-center justify-center gap-1.5"
                            >
                                <i className="ri-add-line"></i> Add Delivery Method
                            </button>
                        </div>
                    </div>

                    <div className="flex justify-end space-x-3 mt-6">
                        <button
                            onClick={() => setIsEditing(false)}
                            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-6 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800"
                        >
                            Save Zone
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="text-left py-4 px-6 font-semibold text-gray-700">Region Name</th>
                            <th className="text-left py-4 px-6 font-semibold text-gray-700">Base Fee</th>
                            <th className="text-left py-4 px-6 font-semibold text-gray-700">Per-Item Fee</th>
                            <th className="text-left py-4 px-6 font-semibold text-gray-700">Methods / Perks</th>
                            <th className="text-left py-4 px-6 font-semibold text-gray-700">Transport</th>
                            <th className="text-left py-4 px-6 font-semibold text-gray-700">Type</th>
                            <th className="text-left py-4 px-6 font-semibold text-gray-700">Status</th>
                            <th className="text-left py-4 px-6 font-semibold text-gray-700 sticky right-0 bg-gray-50 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {zones.map((zone) => (
                            <tr key={zone.id} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="py-4 px-6 font-medium text-gray-900">{zone.name}</td>
                                <td className="py-4 px-6 text-gray-700">GH₵ {zone.base_fee?.toFixed(2)}</td>
                                <td className="py-4 px-6 text-gray-700">
                                    {zone.per_item_fee > 0 ? `GH₵ ${zone.per_item_fee.toFixed(2)}` : '—'}
                                </td>
                                <td className="py-4 px-6">
                                    <div className="flex flex-wrap gap-1">
                                        {(Array.isArray(zone.methods) ? zone.methods : []).filter((m: any) => m?.name).map((m: any) => (
                                            <span
                                                key={m.id || m.name}
                                                className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.active !== false ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-400 line-through'}`}
                                            >
                                                {m.name} · GH₵{Number(m.fee || 0).toFixed(0)}
                                            </span>
                                        ))}
                                        {zone.free_delivery && (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">FREE delivery</span>
                                        )}
                                        {!zone.free_delivery && Number(zone.discount_percent) > 0 && (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">-{Number(zone.discount_percent)}% fee</span>
                                        )}
                                        {(!zone.methods || zone.methods.length === 0) && !zone.free_delivery && !(Number(zone.discount_percent) > 0) && (
                                            <span className="text-gray-400 text-xs">—</span>
                                        )}
                                    </div>
                                </td>
                                <td className="py-4 px-6 text-gray-700">
                                    {zone.transport_service || '—'}
                                </td>
                                <td className="py-4 px-6">
                                    {zone.is_accra ? (
                                        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-bold">Inside Accra</span>
                                    ) : (
                                        <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">Region</span>
                                    )}
                                </td>
                                <td className="py-4 px-6">
                                    {zone.is_active ? (
                                        <span className="text-emerald-600 text-sm font-semibold flex items-center">
                                            <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2"></span>
                                            Active
                                        </span>
                                    ) : (
                                        <span className="text-gray-400 text-sm font-medium">Inactive</span>
                                    )}
                                </td>
                                <td className="py-4 px-6 sticky right-0 bg-white shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]">
                                    <div className="flex space-x-2">
                                        <button
                                            onClick={() => handleEdit(zone)}
                                            className="p-2 hover:bg-blue-50 text-blue-600 rounded transition"
                                            title="Edit zone"
                                            aria-label={`Edit ${zone.name}`}
                                        >
                                            <i className="ri-pencil-line"></i>
                                        </button>
                                        <button
                                            onClick={() => handleDelete(zone.id)}
                                            className="p-2 hover:bg-red-50 text-red-600 rounded transition"
                                            title="Delete zone"
                                            aria-label={`Delete ${zone.name}`}
                                        >
                                            <i className="ri-delete-bin-line"></i>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
                {zones.length === 0 && (
                    <div className="p-8 text-center text-gray-500">
                        No delivery zones found. Add one to get started.
                    </div>
                )}
            </div>

            <div className="bg-amber-50 rounded-xl border border-amber-200 p-6">
                <div className="flex items-start gap-3">
                    <i className="ri-information-line text-amber-600 text-xl mt-0.5"></i>
                    <div>
                        <h3 className="font-bold text-amber-900 mb-1">Outside Accra Delivery Fee Calculation</h3>
                        <p className="text-amber-800 text-sm">
                            For locations outside Accra, the delivery fee is calculated as: <strong>Base Fee + (Per-Item Fee × Number of Items)</strong>.
                            For Accra zones, only the base fee applies regardless of item count.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
