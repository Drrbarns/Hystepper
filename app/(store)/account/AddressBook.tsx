'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

interface Address {
  id: string;
  label: string | null;
  full_name: string;
  phone: string;
  address_line1: string;
  city: string;
  state: string; // delivery zone / region name (matches checkout areas)
  is_default: boolean;
}

interface Zone {
  id: string;
  name: string;
  is_accra: boolean;
}

const emptyForm = {
  label: '',
  fullName: '',
  phone: '',
  street: '',
  city: '',
  zone: '',
  isDefault: false,
};

export default function AddressBook() {
  const [userId, setUserId] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        setUserId(session.user.id);

        const [addrRes, zoneRes] = await Promise.all([
          supabase
            .from('addresses')
            .select('id, label, full_name, phone, address_line1, city, state, is_default')
            .eq('user_id', session.user.id)
            .order('is_default', { ascending: false })
            .order('created_at', { ascending: false }),
          supabase
            .from('delivery_zones')
            .select('id, name, is_accra')
            .eq('is_active', true)
            .order('name'),
        ]);
        if (addrRes.error) throw addrRes.error;
        setAddresses(addrRes.data || []);
        setZones(zoneRes.data || []);
      } catch (err) {
        console.error('Failed to load addresses:', err);
        toast.error('Could not load your addresses');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const startNew = () => {
    setForm(emptyForm);
    setEditingId(null);
    setFormError('');
    setShowForm(true);
  };

  const startEdit = (a: Address) => {
    setForm({
      label: a.label || '',
      fullName: a.full_name,
      phone: a.phone,
      street: a.address_line1,
      city: a.city,
      zone: a.state,
      isDefault: a.is_default,
    });
    setEditingId(a.id);
    setFormError('');
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!form.fullName.trim()) return setFormError('Full name is required');
    const cleanPhone = form.phone.replace(/[\s\-()]/g, '');
    if (!/^(\+233|0)\d{9}$/.test(cleanPhone)) {
      return setFormError('Enter a valid Ghanaian phone number (e.g. 0241234567)');
    }
    if (!form.street.trim()) return setFormError('Street address is required');
    if (!form.city.trim()) return setFormError('City is required');
    if (!form.zone) return setFormError('Choose your delivery area — it must match the areas offered at checkout');
    if (!userId) return setFormError('You need to be signed in');

    setSaving(true);
    try {
      // A user has at most one default — clear the flag elsewhere first.
      if (form.isDefault) {
        await supabase.from('addresses').update({ is_default: false }).eq('user_id', userId);
      }

      const payload = {
        user_id: userId,
        type: 'shipping',
        label: form.label.trim() || null,
        full_name: form.fullName.trim(),
        phone: form.phone.trim(),
        address_line1: form.street.trim(),
        address_line2: null,
        city: form.city.trim(),
        state: form.zone,
        postal_code: '',
        country: 'Ghana',
        is_default: form.isDefault || addresses.length === 0,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error } = await supabase.from('addresses').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('addresses').insert(payload);
        if (error) throw error;
      }

      // Re-fetch for fresh ids/ordering.
      const { data } = await supabase
        .from('addresses')
        .select('id, label, full_name, phone, address_line1, city, state, is_default')
        .eq('user_id', userId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });
      setAddresses(data || []);
      setShowForm(false);
      setEditingId(null);
      toast.success(editingId ? 'Address updated' : 'Address saved');
    } catch (err: any) {
      console.error('Address save failed:', err);
      setFormError(err?.message || 'Could not save the address. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const deleteAddress = async (id: string) => {
    const prev = addresses;
    setAddresses(prev.filter(a => a.id !== id));
    const { error } = await supabase.from('addresses').delete().eq('id', id);
    if (error) {
      setAddresses(prev);
      toast.error('Could not delete the address');
    } else {
      toast.success('Address deleted');
    }
  };

  const setDefault = async (id: string) => {
    if (!userId) return;
    const prev = addresses;
    setAddresses(prev.map(a => ({ ...a, is_default: a.id === id })));
    const { error: clearError } = await supabase
      .from('addresses')
      .update({ is_default: false })
      .eq('user_id', userId);
    const { error: setError } = clearError
      ? { error: clearError }
      : await supabase.from('addresses').update({ is_default: true }).eq('id', id);
    if (clearError || setError) {
      setAddresses(prev);
      toast.error('Could not update the default address');
    }
  };

  const accraZones = zones.filter(z => z.is_accra);
  const otherZones = zones.filter(z => !z.is_accra);

  if (loading) {
    return (
      <div className="py-16 text-center">
        <i className="ri-loader-4-line animate-spin text-3xl text-gold-600"></i>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-2xl font-bold text-gray-900">Address Book</h2>
        <button
          onClick={startNew}
          className="px-4 py-2 bg-gold-600 text-white rounded-lg font-semibold hover:bg-gold-700 transition-colors whitespace-nowrap cursor-pointer"
        >
          <i className="ri-add-line mr-2"></i>
          Add New Address
        </button>
      </div>
      <p className="text-gray-500 text-sm mb-6">
        Saved addresses can be selected at checkout to fill your shipping details in one tap.
      </p>

      {showForm && (
        <div className="bg-white border-2 border-gold-500 rounded-xl p-6 mb-6">
          <h3 className="text-xl font-bold text-gray-900 mb-4">
            {editingId ? 'Edit Address' : 'New Address'}
          </h3>

          {formError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              <i className="ri-error-warning-line mr-1"></i>{formError}
            </div>
          )}

          <form onSubmit={handleSave} className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Label <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                type="text"
                value={form.label}
                onChange={e => setForm({ ...form, label: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-400 focus:border-transparent"
                placeholder="Home, Work…"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Full Name *</label>
              <input
                type="text"
                value={form.fullName}
                onChange={e => setForm({ ...form, fullName: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-400 focus:border-transparent"
                placeholder="John Doe"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Phone Number *</label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-400 focus:border-transparent"
                placeholder="0241234567"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2">Delivery Area *</label>
              <select
                value={form.zone}
                onChange={e => setForm({ ...form, zone: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-400 focus:border-transparent bg-white"
              >
                <option value="">Select your area…</option>
                {accraZones.length > 0 && (
                  <optgroup label="Greater Accra">
                    {accraZones.map(z => (
                      <option key={z.id} value={z.name}>{z.name}</option>
                    ))}
                  </optgroup>
                )}
                {otherZones.length > 0 && (
                  <optgroup label="Other Regions">
                    {otherZones.map(z => (
                      <option key={z.id} value={z.name}>{z.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-900 mb-2">Street Address *</label>
              <input
                type="text"
                value={form.street}
                onChange={e => setForm({ ...form, street: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-400 focus:border-transparent"
                placeholder="123 Oxford Street"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-900 mb-2">City / Town *</label>
              <input
                type="text"
                value={form.city}
                onChange={e => setForm({ ...form, city: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-400 focus:border-transparent"
                placeholder="Accra"
              />
            </div>
            <div className="md:col-span-2">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={e => setForm({ ...form, isDefault: e.target.checked })}
                  className="w-4 h-4 text-gold-600 border-gray-300 rounded focus:ring-gold-500"
                />
                <span className="ml-2 text-sm text-gray-700">Set as default address</span>
              </label>
            </div>
            <div className="md:col-span-2 flex space-x-3">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-3 bg-gold-600 text-white rounded-lg font-semibold hover:bg-gold-700 transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Saving…' : 'Save Address'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                }}
                className="flex-1 py-3 border-2 border-gray-300 text-gray-900 rounded-lg font-semibold hover:bg-gray-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {addresses.length === 0 && !showForm ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <div className="w-14 h-14 mx-auto mb-3 bg-white rounded-full flex items-center justify-center shadow-sm">
            <i className="ri-map-pin-2-line text-2xl text-gray-400"></i>
          </div>
          <p className="text-gray-600 font-medium mb-1">No saved addresses yet</p>
          <p className="text-sm text-gray-500">Add one and it&apos;ll be a single tap away at checkout.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {addresses.map((address) => (
            <div
              key={address.id}
              className={`bg-white border-2 rounded-xl p-6 relative ${address.is_default ? 'border-gold-500' : 'border-gray-200'}`}
            >
              {address.is_default && (
                <div className="absolute top-4 right-4">
                  <span className="px-3 py-1 bg-gold-500 text-white text-xs font-semibold rounded-full whitespace-nowrap">
                    Default
                  </span>
                </div>
              )}

              <div className="mb-4">
                {address.label && (
                  <p className="text-xs font-semibold text-gold-600 uppercase tracking-wide mb-1">{address.label}</p>
                )}
                <h3 className="text-lg font-bold text-gray-900">{address.full_name}</h3>
                <p className="text-gray-600">{address.phone}</p>
              </div>

              <div className="text-gray-700 space-y-1 mb-6 text-sm">
                <p>{address.address_line1}</p>
                <p>{address.city}{address.state ? `, ${address.state}` : ''}</p>
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={() => startEdit(address)}
                  className="flex-1 py-2 border border-gray-300 text-gray-900 rounded-lg font-semibold hover:bg-gray-50 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Edit
                </button>
                {!address.is_default && (
                  <button
                    onClick={() => setDefault(address.id)}
                    className="flex-1 py-2 border border-gold-500 text-gold-600 rounded-lg font-semibold hover:bg-gold-50 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Set Default
                  </button>
                )}
                <button
                  onClick={() => deleteAddress(address.id)}
                  className="px-4 py-2 border border-red-500 text-red-500 rounded-lg font-semibold hover:bg-red-50 transition-colors whitespace-nowrap cursor-pointer"
                  aria-label="Delete address"
                >
                  <i className="ri-delete-bin-line"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
