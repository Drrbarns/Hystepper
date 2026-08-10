'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import AdminTableScroll from '@/components/admin/AdminTableScroll';

// NOTE: 'dashboard' is intentionally NOT a togglable permission. The dashboard
// shows aggregate revenue/profit data and is reserved for super-admins only.
const PERMISSION_LABELS: Record<string, { label: string; icon: string; description: string }> = {
  orders:        { label: 'Orders',           icon: 'ri-shopping-bag-line',    description: 'View & manage orders' },
  delivery:      { label: 'Delivery',         icon: 'ri-truck-line',           description: 'Assign orders to riders & track deliveries' },
  order_status:  { label: 'Update Delivery',  icon: 'ri-checkbox-circle-line', description: 'Mark orders as delivered/completed only' },
  pos:           { label: 'POS System',       icon: 'ri-store-3-line',         description: 'Use point of sale' },
  products:      { label: 'Products',         icon: 'ri-box-3-line',           description: 'Add & edit products' },
  categories:    { label: 'Categories',       icon: 'ri-folder-line',          description: 'Manage categories' },
  customers:     { label: 'Customers',        icon: 'ri-group-line',           description: 'View customer data' },
  reviews:       { label: 'Reviews',          icon: 'ri-chat-smile-2-line',    description: 'Moderate reviews' },
  inventory:     { label: 'Inventory',        icon: 'ri-stack-line',           description: 'Manage stock levels' },
  analytics:     { label: 'Analytics',        icon: 'ri-bar-chart-line',       description: 'View reports & stats' },
  coupons:       { label: 'Coupons',          icon: 'ri-coupon-2-line',        description: 'Create & edit coupons' },
  notifications: { label: 'Notifications',   icon: 'ri-notification-3-line',  description: 'Send notifications' },
  blog:          { label: 'Blog',             icon: 'ri-article-line',         description: 'Write blog posts' },
  modules:       { label: 'Modules',          icon: 'ri-puzzle-line',          description: 'Toggle store modules' },
  settings:      { label: 'Settings',         icon: 'ri-settings-3-line',      description: 'Change store settings' },
  staff:         { label: 'Staff Management', icon: 'ri-user-settings-line',   description: 'Add & manage staff' },
};

const ROLE_PRESETS: Record<string, Record<string, boolean>> = {
  admin: Object.fromEntries(Object.keys(PERMISSION_LABELS).map(k => [k, true])),
  manager: {
    orders: true, delivery: true, order_status: true, pos: true,
    products: true, categories: true, customers: true, reviews: true, inventory: true,
    analytics: true, coupons: true, notifications: false, blog: false, modules: false,
    settings: false, staff: false,
  },
  staff: {
    orders: true, delivery: false, order_status: true, pos: true,
    products: false, categories: false, customers: false, reviews: false, inventory: false,
    analytics: false, coupons: false, notifications: false, blog: false, modules: false,
    settings: false, staff: false,
  },
  rider: {
    orders: true, delivery: false, order_status: true, pos: false,
    products: false, categories: false, customers: false, reviews: false, inventory: false,
    analytics: false, coupons: false, notifications: false, blog: false, modules: false,
    settings: false, staff: false,
  },
};

type StaffMember = {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'manager' | 'staff' | 'rider';
  permissions: Record<string, boolean>;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
};

const defaultPermissions = Object.fromEntries(Object.keys(PERMISSION_LABELS).map(k => [k, false]));

export default function StaffPage() {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [inviteForm, setInviteForm] = useState({
    email: '',
    full_name: '',
    password: '',
    showPassword: false,
    role: 'staff' as 'admin' | 'manager' | 'staff' | 'rider',
    permissions: { ...ROLE_PRESETS.staff },
  });

  useEffect(() => { fetchStaff(); }, []);

  async function fetchStaff() {
    setLoading(true);
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setStaffList(data);
    setLoading(false);
  }

  function showToast(type: 'success' | 'error', message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleInvite() {
    if (!inviteForm.email.trim() || !inviteForm.full_name.trim()) {
      showToast('error', 'Name and email are required.');
      return;
    }
    if (!inviteForm.password || inviteForm.password.length < 8) {
      showToast('error', 'Password must be at least 8 characters.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/create-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteForm.email.trim().toLowerCase(),
          full_name: inviteForm.full_name.trim(),
          password: inviteForm.password,
          role: inviteForm.role,
          permissions: inviteForm.permissions,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        showToast('error', result.error || 'Failed to create staff account.');
      } else {
        showToast('success', `${inviteForm.full_name} added successfully. They can log in at /admin/login.`);
        setShowInviteModal(false);
        setInviteForm({ email: '', full_name: '', password: '', showPassword: false, role: 'staff' as 'admin' | 'manager' | 'staff' | 'rider', permissions: { ...ROLE_PRESETS.staff } });
        fetchStaff();
      }
    } catch {
      showToast('error', 'Network error. Please try again.');
    }
    setSaving(false);
  }

  async function handleUpdateStaff() {
    if (!editingStaff) return;
    setSaving(true);
    const { data: updatedRows, error } = await supabase
      .from('staff')
      .update({
        full_name: editingStaff.full_name,
        role: editingStaff.role,
        permissions: editingStaff.permissions,
        is_active: editingStaff.is_active,
      })
      .eq('id', editingStaff.id)
      .select('id');
    setSaving(false);
    if (error) {
      showToast('error', error.message);
    } else if (!updatedRows || updatedRows.length === 0) {
      // No error but nothing changed = RLS blocked the write (you need an admin
      // profile to manage staff).
      showToast('error', "Update was blocked — you may not have permission to manage staff.");
    } else {
      showToast('success', 'Staff member updated.');
      setEditingStaff(null);
      fetchStaff();
    }
  }

  async function handleToggleActive(member: StaffMember) {
    const { data: updatedRows, error } = await supabase
      .from('staff')
      .update({ is_active: !member.is_active })
      .eq('id', member.id)
      .select('id');
    if (error) {
      showToast('error', error.message);
    } else if (!updatedRows || updatedRows.length === 0) {
      showToast('error', "Couldn't change status — you may not have permission to manage staff.");
    } else {
      fetchStaff();
    }
  }

  async function handleDelete(id: string) {
    setSaving(true);
    try {
      // Goes through the service-role API so it removes BOTH the staff row and
      // the underlying login account. A plain client-side delete only removed
      // the row (and could be silently blocked by RLS), leaving an orphaned
      // login that then blocked re-adding the same email.
      const res = await fetch('/api/admin/delete-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', result.error || 'Failed to remove staff member.');
      } else {
        showToast('success', 'Staff member removed.');
        setDeleteConfirm(null);
        fetchStaff();
      }
    } catch {
      showToast('error', 'Network error. Please try again.');
    }
    setSaving(false);
  }

  function applyRolePreset(role: 'admin' | 'manager' | 'staff' | 'rider', target: 'invite' | 'edit') {
    const preset = { ...ROLE_PRESETS[role] };
    if (target === 'invite') {
      setInviteForm(f => ({ ...f, role, permissions: preset }));
    } else if (editingStaff) {
      setEditingStaff(e => e ? { ...e, role, permissions: preset } : e);
    }
  }

  function togglePermission(key: string, target: 'invite' | 'edit') {
    if (target === 'invite') {
      setInviteForm(f => ({ ...f, permissions: { ...f.permissions, [key]: !f.permissions[key] } }));
    } else if (editingStaff) {
      setEditingStaff(e => e ? { ...e, permissions: { ...e.permissions, [key]: !e.permissions[key] } } : e);
    }
  }

  const roleColors: Record<string, string> = {
    admin:   'bg-purple-100 text-purple-700',
    manager: 'bg-blue-100 text-blue-700',
    staff:   'bg-gray-100 text-gray-700',
    rider:   'bg-sky-100 text-sky-700',
  };

  const permissionsForModal = (target: 'invite' | 'edit') =>
    target === 'invite' ? inviteForm.permissions : (editingStaff?.permissions ?? defaultPermissions);

  const PermissionGrid = ({ target }: { target: 'invite' | 'edit' }) => {
    const perms = permissionsForModal(target);
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
        {Object.entries(PERMISSION_LABELS).map(([key, meta]) => {
          const enabled = !!perms[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => togglePermission(key, target)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left ${
                enabled
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              <div className={`w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 ${
                enabled ? 'bg-emerald-100' : 'bg-gray-200'
              }`}>
                <i className={`${meta.icon} text-sm`}></i>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight">{meta.label}</p>
                <p className="text-xs opacity-60 leading-tight">{meta.description}</p>
              </div>
              <div className="ml-auto flex-shrink-0">
                <div className={`w-9 h-5 rounded-full transition-colors relative ${
                  enabled ? 'bg-emerald-500' : 'bg-gray-300'
                }`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    enabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
          toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        }`}>
          <i className={toast.type === 'success' ? 'ri-check-line text-lg' : 'ri-error-warning-line text-lg'}></i>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Management</h1>
          <p className="text-sm text-gray-500 mt-1">Manage team members and control their access to dashboard features.</p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg font-medium text-sm transition-colors cursor-pointer"
        >
          <i className="ri-user-add-line"></i>
          Add Staff
        </button>
      </div>

      {/* Role Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {(['admin', 'manager', 'staff', 'rider'] as const).map(role => (
          <div key={role} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleColors[role]}`}>
                {role === 'rider' ? '🛵 Rider' : role.charAt(0).toUpperCase() + role.slice(1)}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              {role === 'admin' && 'Full access to all features and settings.'}
              {role === 'manager' && 'Access to orders, products, customers and analytics.'}
              {role === 'staff' && 'Basic access: dashboard, orders and POS only.'}
              {role === 'rider' && 'Rider app: mark delivered, completed, or could not deliver (returned).'}
            </p>
          </div>
        ))}
      </div>

      {/* Staff Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <i className="ri-loader-4-line animate-spin text-2xl mr-3"></i>
            Loading staff...
          </div>
        ) : staffList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <i className="ri-user-3-line text-5xl mb-3 opacity-30"></i>
            <p className="font-medium text-gray-500">No staff members yet</p>
            <p className="text-sm mt-1">Add your first staff member to get started.</p>
          </div>
        ) : (
          <AdminTableScroll>
          <table className="w-full min-w-[36rem]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="px-5 py-3 text-left">Name / Email</th>
                <th className="px-5 py-3 text-left">Role</th>
                <th className="px-5 py-3 text-left">Permissions</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Added</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {staffList.map(member => {
                const permCount = Object.values(member.permissions).filter(Boolean).length;
                const totalPerms = Object.keys(PERMISSION_LABELS).length;
                return (
                  <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                          {member.full_name?.[0]?.toUpperCase() || member.email[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{member.full_name || '—'}</p>
                          <p className="text-xs text-gray-500">{member.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${roleColors[member.role]}`}>
                        {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 max-w-24 bg-gray-100 rounded-full h-1.5">
                          <div
                            className="bg-emerald-500 h-1.5 rounded-full"
                            style={{ width: `${(permCount / totalPerms) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{permCount}/{totalPerms}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => handleToggleActive(member)}
                        className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                          member.is_active
                            ? 'bg-green-50 text-green-700 hover:bg-green-100'
                            : 'bg-red-50 text-red-600 hover:bg-red-100'
                        }`}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full ${member.is_active ? 'bg-green-500' : 'bg-red-400'}`} />
                        {member.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-5 py-4 text-xs text-gray-400">
                      {new Date(member.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditingStaff({ ...member, permissions: { ...defaultPermissions, ...member.permissions } })}
                          className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                          title="Edit"
                        >
                          <i className="ri-edit-line"></i>
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(member.id)}
                          className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                          title="Remove"
                        >
                          <i className="ri-delete-bin-line"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </AdminTableScroll>
        )}
      </div>

      {/* ── Invite Modal ── */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Add Staff Member</h2>
                <p className="text-sm text-gray-500">Set their details and configure access permissions.</p>
              </div>
              <button onClick={() => setShowInviteModal(false)} className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-lg cursor-pointer">
                <i className="ri-close-line text-xl text-gray-500"></i>
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Basic info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={inviteForm.full_name}
                    onChange={e => setInviteForm(f => ({ ...f, full_name: e.target.value }))}
                    placeholder="e.g. Ama Asante"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email Address <span className="text-red-500">*</span></label>
                  <input
                    type="email"
                    value={inviteForm.email}
                    onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="staff@example.com"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Temporary Password <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={inviteForm.showPassword ? 'text' : 'password'}
                    value={inviteForm.password}
                    onChange={e => setInviteForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Min. 8 characters"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                  <button
                    type="button"
                    onClick={() => setInviteForm(f => ({ ...f, showPassword: !f.showPassword }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                  >
                    <i className={inviteForm.showPassword ? 'ri-eye-off-line' : 'ri-eye-line'}></i>
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Staff will use this password to log in at <span className="font-medium">/admin/login</span>. They can change it later.</p>
              </div>

              {/* Role selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Role Preset</label>
                <div className="flex gap-2 flex-wrap">
                  {(['admin', 'manager', 'staff', 'rider'] as const).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => applyRolePreset(r, 'invite')}
                      className={`flex-1 min-w-[80px] py-2 rounded-lg border text-sm font-medium transition-all cursor-pointer ${
                        inviteForm.role === r
                          ? r === 'rider'
                            ? 'border-blue-400 bg-blue-50 text-blue-700'
                            : 'border-emerald-400 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {r === 'rider' ? '🛵 Rider' : r.charAt(0).toUpperCase() + r.slice(1)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">Selecting a role applies a default set of permissions. You can customise below.</p>
              </div>

              {/* Permissions */}
              <div>
                <label className="block text-sm font-medium text-gray-700">Permissions</label>
                <PermissionGrid target="invite" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-100">
              <button onClick={() => setShowInviteModal(false)} className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg cursor-pointer">
                Cancel
              </button>
              <button
                onClick={handleInvite}
                disabled={saving}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              >
                {saving ? <i className="ri-loader-4-line animate-spin"></i> : <i className="ri-user-add-line"></i>}
                Add Staff Member
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Edit Staff Member</h2>
                <p className="text-sm text-gray-500">{editingStaff.email}</p>
              </div>
              <button onClick={() => setEditingStaff(null)} className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-lg cursor-pointer">
                <i className="ri-close-line text-xl text-gray-500"></i>
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    value={editingStaff.full_name}
                    onChange={e => setEditingStaff(s => s ? { ...s, full_name: e.target.value } : s)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Status</label>
                  <button
                    type="button"
                    onClick={() => setEditingStaff(s => s ? { ...s, is_active: !s.is_active } : s)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm font-medium cursor-pointer transition-colors ${
                      editingStaff.is_active
                        ? 'bg-green-50 border-green-200 text-green-700'
                        : 'bg-red-50 border-red-200 text-red-600'
                    }`}
                  >
                    <span>{editingStaff.is_active ? 'Active — can log in' : 'Inactive — access blocked'}</span>
                    <div className={`w-9 h-5 rounded-full relative flex-shrink-0 ${editingStaff.is_active ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${editingStaff.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Role Preset</label>
                <div className="flex gap-2 flex-wrap">
                  {(['admin', 'manager', 'staff', 'rider'] as const).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => applyRolePreset(r, 'edit')}
                      className={`flex-1 min-w-[80px] py-2 rounded-lg border text-sm font-medium transition-all cursor-pointer ${
                        editingStaff.role === r
                          ? r === 'rider'
                            ? 'border-blue-400 bg-blue-50 text-blue-700'
                            : 'border-emerald-400 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {r === 'rider' ? '🛵 Rider' : r.charAt(0).toUpperCase() + r.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Permissions</label>
                <PermissionGrid target="edit" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-100">
              <button onClick={() => setEditingStaff(null)} className="px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg cursor-pointer">
                Cancel
              </button>
              <button
                onClick={handleUpdateStaff}
                disabled={saving}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer"
              >
                {saving ? <i className="ri-loader-4-line animate-spin"></i> : <i className="ri-save-line"></i>}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-14 h-14 mx-auto bg-red-100 rounded-full flex items-center justify-center mb-4">
              <i className="ri-delete-bin-line text-2xl text-red-600"></i>
            </div>
            <h3 className="font-bold text-gray-900 text-lg mb-1">Remove Staff Member?</h3>
            <p className="text-sm text-gray-500 mb-5">This will permanently remove their access to the dashboard.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 cursor-pointer">
                Cancel
              </button>
              <button onClick={() => handleDelete(deleteConfirm)} disabled={saving} className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium cursor-pointer flex items-center justify-center gap-2">
                {saving && <i className="ri-loader-4-line animate-spin"></i>}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
