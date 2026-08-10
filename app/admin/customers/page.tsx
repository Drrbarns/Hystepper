'use client';

import Link from 'next/link';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import AdminTableScroll from '@/components/admin/AdminTableScroll';

export default function AdminCustomersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortOption, setSortOption] = useState('Sort by Join Date');
  const [filterStatus, setFilterStatus] = useState('All Customers');

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      const { data: profiles, error: pError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (pError) throw pError;

      const { data: orders, error: oError } = await supabase
        .from('orders')
        .select('id, user_id, email, phone, total, created_at, status, metadata, shipping_address');

      if (oError) throw oError;

      const registeredIds = new Set((profiles || []).map(p => p.id));
      const allCustomers: any[] = [];

      // 1. Registered users from profiles
      (profiles || []).forEach(profile => {
        const userOrders = orders?.filter(o => o.user_id === profile.id && o.status !== 'cancelled') || [];
        const totalSpent = userOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
        let lastOrderDate: Date | null = null;
        if (userOrders.length > 0) {
          lastOrderDate = new Date(Math.max(...userOrders.map(o => new Date(o.created_at).getTime())));
        }
        let status = 'New';
        if (totalSpent > 1000) status = 'VIP';
        else if (userOrders.length > 0) status = 'Active';
        else if (new Date(profile.created_at).getTime() < Date.now() - 30 * 24 * 60 * 60 * 1000) status = 'Inactive';

        allCustomers.push({
          id: profile.id,
          name: profile.full_name || 'No Name',
          email: profile.email,
          phone: profile.phone || 'N/A',
          avatar: getInitials(profile.full_name || profile.email),
          orders: userOrders.length,
          totalSpent,
          joined: new Date(profile.created_at).toLocaleDateString(),
          lastOrder: lastOrderDate ? timeAgo(lastOrderDate) : 'Never',
          status,
          type: 'Registered',
          rawJoined: new Date(profile.created_at),
          rawLastOrder: lastOrderDate
        });
      });

      // 2. Guest customers (orders without a registered user_id)
      const guestOrders = (orders || []).filter(o => !o.user_id || !registeredIds.has(o.user_id));
      const guestMap = new Map<string, any[]>();
      guestOrders.forEach(o => {
        const key = (o.email || '').toLowerCase();
        if (!key || key === 'pos@store.local') return;
        if (!guestMap.has(key)) guestMap.set(key, []);
        guestMap.get(key)!.push(o);
      });

      guestMap.forEach((gOrders, email) => {
        const nonCancelled = gOrders.filter(o => o.status !== 'cancelled');
        const totalSpent = nonCancelled.reduce((sum, o) => sum + Number(o.total || 0), 0);
        const allDates = gOrders.map(o => new Date(o.created_at).getTime());
        const firstSeen = new Date(Math.min(...allDates));
        const lastSeen = new Date(Math.max(...allDates));

        const guestName = gOrders[0]?.metadata?.first_name
          ? `${gOrders[0].metadata.first_name} ${gOrders[0].metadata.last_name || ''}`.trim()
          : gOrders[0]?.shipping_address?.name || email.split('@')[0];
        const guestPhone = gOrders[0]?.phone || gOrders[0]?.metadata?.phone || 'N/A';

        const hasPending = gOrders.some(o => o.status === 'pending');
        const hasCompleted = nonCancelled.some(o => ['delivered', 'completed'].includes(o.status));

        allCustomers.push({
          id: `guest-${email}`,
          name: guestName,
          email,
          phone: guestPhone,
          avatar: getInitials(guestName),
          orders: nonCancelled.length,
          totalSpent,
          joined: firstSeen.toLocaleDateString(),
          lastOrder: timeAgo(lastSeen),
          status: hasCompleted ? 'Active' : hasPending ? 'Pending' : 'Abandoned',
          type: 'Guest',
          rawJoined: firstSeen,
          rawLastOrder: lastSeen
        });
      });

      setCustomers(allCustomers);
    } catch (error) {
      console.error('Error fetching customers:', error);
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const timeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    return "Just now";
  }

  const statusColors: any = {
    'New': 'bg-blue-100 text-blue-700',
    'Active': 'bg-emerald-100 text-emerald-700',
    'VIP': 'bg-purple-100 text-purple-700',
    'Inactive': 'bg-gray-100 text-gray-700',
    'Pending': 'bg-amber-100 text-amber-700',
    'Abandoned': 'bg-red-100 text-red-700'
  };

  const handleSelectAll = () => {
    if (selectedCustomers.length === customers.length) {
      setSelectedCustomers([]);
    } else {
      setSelectedCustomers(customers.map(c => c.id));
    }
  };

  const handleSelectCustomer = (customerId: string) => {
    if (selectedCustomers.includes(customerId)) {
      setSelectedCustomers(selectedCustomers.filter(id => id !== customerId));
    } else {
      setSelectedCustomers([...selectedCustomers, customerId]);
    }
  };

  // Memoized filter and sort
  const filteredCustomers = useMemo(() => {
    let result = customers;

    // Filter by Status
    if (filterStatus !== 'All Customers') {
      result = result.filter(c => c.status === filterStatus);
    }

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortOption === 'Sort by Name') return a.name.localeCompare(b.name);
      if (sortOption === 'Sort by Orders') return b.orders - a.orders;
      if (sortOption === 'Sort by Spent') return b.totalSpent - a.totalSpent;
      if (sortOption === 'Sort by Join Date') return b.rawJoined.getTime() - a.rawJoined.getTime();
      return 0;
    });

    return result;
  }, [customers, searchQuery, sortOption, filterStatus]);

  // Derived Stats
  const stats = useMemo(() => ({
    total: customers.length,
    newThisMonth: customers.filter(c => {
      const d = new Date(c.rawJoined);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length,
    vip: customers.filter(c => c.status === 'VIP').length,
    avgLTV: customers.length > 0 ? (customers.reduce((sum, c) => sum + c.totalSpent, 0) / customers.length) : 0
  }), [customers]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-600 mt-1 text-sm sm:text-base">Manage your customer base and relationships</p>
        </div>
        <button className="bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 sm:px-6 sm:py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer self-start sm:self-auto text-sm sm:text-base">
          <i className="ri-download-line mr-2"></i>
          Export Customers
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Customers</p>
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">New This Month</p>
          <p className="text-2xl font-bold text-emerald-700">{stats.newThisMonth}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">VIP Customers</p>
          <p className="text-2xl font-bold text-purple-700">{stats.vip}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Avg Lifetime Value</p>
          <p className="text-2xl font-bold text-gray-900">GH₵ {stats.avgLTV.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg flex items-center justify-center"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, email, or phone..."
                  className="w-full pl-12 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-medium cursor-pointer"
              >
                <option>All Customers</option>
                <option>New</option>
                <option>Active</option>
                <option>VIP</option>
                <option>Inactive</option>
                <option>Pending</option>
                <option>Abandoned</option>
              </select>
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value)}
                className="px-4 py-3 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-medium cursor-pointer"
              >
                <option>Sort by Join Date</option>
                <option>Sort by Name</option>
                <option>Sort by Orders</option>
                <option>Sort by Spent</option>
              </select>
            </div>
          </div>
        </div>

        {selectedCustomers.length > 0 && (
          <div className="p-4 bg-emerald-50 border-b border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-emerald-800 font-semibold text-sm">
              {selectedCustomers.length} customer{selectedCustomers.length > 1 ? 's' : ''} selected
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer">
                <i className="ri-mail-line mr-1"></i>
                Email
              </button>
              <button className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer">
                <i className="ri-vip-crown-line mr-1"></i>
                VIP
              </button>
              <button className="px-3 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer">
                <i className="ri-download-line mr-1"></i>
                Export
              </button>
            </div>
          </div>
        )}

        <AdminTableScroll>
          <table className="w-full min-w-[48rem]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="py-4 px-6">
                  <input
                    type="checkbox"
                    checked={selectedCustomers.length === filteredCustomers.length && filteredCustomers.length > 0}
                    onChange={handleSelectAll}
                    className="w-4 h-4 text-emerald-700 border-gray-300 rounded focus:ring-emerald-500 cursor-pointer"
                  />
                </th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Customer</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Contact</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Orders</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Total Spent</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Last Order</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-10 text-center text-gray-500">Loading customers...</td></tr>
              ) : filteredCustomers.length === 0 ? (
                <tr><td colSpan={8} className="p-10 text-center text-gray-500">No customers found.</td></tr>
              ) : (
                filteredCustomers.map((customer) => (
                  <tr key={customer.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <input
                        type="checkbox"
                        checked={selectedCustomers.includes(customer.id)}
                        onChange={() => handleSelectCustomer(customer.id)}
                        className="w-4 h-4 text-emerald-700 border-gray-300 rounded focus:ring-emerald-500 cursor-pointer"
                      />
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <div className={`w-10 h-10 flex items-center justify-center rounded-full font-semibold ${customer.type === 'Guest' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {customer.avatar}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            {customer.type === 'Guest' ? (
                              <span className="font-semibold text-gray-900 whitespace-nowrap">{customer.name}</span>
                            ) : (
                              <Link href={`/admin/customers/${customer.id}`} className="font-semibold text-gray-900 hover:text-emerald-700 whitespace-nowrap">
                                {customer.name}
                              </Link>
                            )}
                            {customer.type === 'Guest' && (
                              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-600 rounded">GUEST</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-500">{customer.type === 'Guest' ? 'First seen' : 'Joined'} {customer.joined}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <p className="text-gray-700 text-sm">{customer.email}</p>
                      <p className="text-gray-600 text-sm">{customer.phone}</p>
                    </td>
                    <td className="py-4 px-4 font-semibold text-gray-900">{customer.orders}</td>
                    <td className="py-4 px-4 font-semibold text-emerald-700 whitespace-nowrap">GH₵ {customer.totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="py-4 px-4 text-gray-700 text-sm whitespace-nowrap">{customer.lastOrder}</td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusColors[customer.status]}`}>
                        {customer.status}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        {customer.type !== 'Guest' && (
                          <Link href={`/admin/customers/${customer.id}`} className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                            <i className="ri-eye-line text-lg"></i>
                          </Link>
                        )}
                        {customer.phone && customer.phone !== 'N/A' && (
                          <a href={`tel:${customer.phone}`} className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer" title="Call">
                            <i className="ri-phone-line text-lg"></i>
                          </a>
                        )}
                        {customer.email && (
                          <a href={`mailto:${customer.email}`} className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer" title="Email">
                            <i className="ri-mail-line text-lg"></i>
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </AdminTableScroll>

        <div className="p-6 border-t border-gray-200 flex items-center justify-between">
          <p className="text-gray-600">Showing {filteredCustomers.length} of {customers.length} customers</p>
          <div className="flex items-center space-x-2">
            {/* Simple pagination place holder logic or hidden if few */}
          </div>
        </div>
      </div>
    </div>
  );
}
