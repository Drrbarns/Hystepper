'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, AreaChart, Area, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState('30days');
  const [reportType, setReportType] = useState('overview');
  const [loading, setLoading] = useState(true);

  const [salesData, setSalesData] = useState<any[]>([]);
  const [categoryRevenue, setCategoryRevenue] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [trackingConfigured, setTrackingConfigured] = useState(false);

  const [metrics, setMetrics] = useState({
    revenue: 0,
    revenueGrowth: 0,
    orders: 0,
    ordersGrowth: 0,
    aov: 0,
    aovGrowth: 0,
    conversion: 0,
    conversionGrowth: 0
  });

  useEffect(() => {
    fetchAnalytics();
  }, [timeRange]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);

      // Calculate start date based on timeRange
      const now = new Date();
      let startDate = new Date();
      if (timeRange === '7days') startDate.setDate(now.getDate() - 7);
      if (timeRange === '30days') startDate.setDate(now.getDate() - 30);
      if (timeRange === '90days') startDate.setDate(now.getDate() - 90);
      if (timeRange === 'year') startDate.setFullYear(now.getFullYear(), 0, 1);

      const isoStart = startDate.toISOString();

      // Is GA4 / Meta Pixel tracking configured?
      const { data: trackingSettings } = await supabase
        .from('store_settings')
        .select('key, value')
        .in('key', ['ga4_measurement_id', 'meta_pixel_id']);
      setTrackingConfigured(
        (trackingSettings || []).some(s => typeof s.value === 'string' && s.value.trim().length > 0)
      );

      // Fetch Orders for Revenue & Count
      const { data: orders, error: orderError } = await supabase
        .from('orders')
        .select('id, created_at, total, shipping_total')
        .gte('created_at', isoStart)
        .in('status', ['delivered', 'shipped', 'processing'])
        .order('created_at');

      if (orderError) throw orderError;

      // Fetch order items for the fetched order IDs (covers website AND POS
      // orders — both live in the same orders/order_items tables).
      // NOTE: order_items has unit_price/total_price, NOT `price` — selecting
      // a non-existent column made this query fail silently, which is why
      // "Top Performing Products" showed "No sales data yet".
      let validItems: any[] = [];
      if (orders && orders.length > 0) {
        const orderIds = orders.map(o => o.id);
        // Chunk the IN() list so very busy periods don't exceed URL limits.
        for (let i = 0; i < orderIds.length; i += 100) {
          const chunk = orderIds.slice(i, i + 100);
          const { data: fetchedItems, error: itemsError } = await supabase
            .from('order_items')
            .select('quantity, unit_price, total_price, product_name, status, products(name, categories(name))')
            .in('order_id', chunk);
          if (itemsError) {
            console.error('Analytics order_items fetch failed:', itemsError);
            break;
          }
          if (fetchedItems) validItems.push(...fetchedItems);
        }
        // Ignore individually cancelled/returned line items.
        validItems = validItems.filter(it => !it.status || it.status === 'active');
      }

      // Process Metrics — delivery fees are excluded: they pass through to
      // riders/couriers and are not store revenue.
      const orderNet = (o: any) => Math.max(0, (o.total || 0) - (o.shipping_total || 0));
      const totalRevenue = orders?.reduce((sum, o) => sum + orderNet(o), 0) || 0;
      const totalOrders = orders?.length || 0;
      const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      setMetrics({
        revenue: totalRevenue,
        revenueGrowth: 0, // Needs comparison with previous period (skipped for simplicity/speed)
        orders: totalOrders,
        ordersGrowth: 0,
        aov: aov,
        aovGrowth: 0,
        conversion: 0, // No visitor data
        conversionGrowth: 0
      });

      // Process Sales Chart Data (Group by Date with Zero-Filling)
      const salesMap: Record<string, any> = {};

      // Initialize map with all dates in range
      const d = new Date(startDate);
      const today = new Date();
      while (d <= today) {
        const dateKey = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        salesMap[dateKey] = {
          date: dateKey,
          sales: 0,
          orders: 0,
          fullDate: d.getTime() // Helper for sorting
        };
        d.setDate(d.getDate() + 1);
      }

      orders?.forEach(o => {
        const dateKey = new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (salesMap[dateKey]) {
          salesMap[dateKey].sales += orderNet(o);
          salesMap[dateKey].orders += 1;
        }
      });

      setSalesData(Object.values(salesMap));

      // Process Category Revenue
      const catMap: Record<string, any> = {};
      validItems.forEach(item => {
        const catName = item.products?.categories?.name || 'Uncategorized';
        if (!catMap[catName]) catMap[catName] = { name: catName, value: 0 };
        catMap[catName].value += Number(item.total_price ?? (item.unit_price || 0) * item.quantity) || 0;
      });
      // Convert to array for Recharts Pie
      const catArray = Object.values(catMap).map((c: any) => ({ name: c.name, value: c.value }));
      setCategoryRevenue(catArray);

      // Process Top Products
      const prodMap: Record<string, any> = {};
      validItems.forEach(item => {
        const pName = item.products?.name || item.product_name || 'Unknown';
        if (!prodMap[pName]) prodMap[pName] = { name: pName, revenue: 0, units: 0 };
        prodMap[pName].revenue += Number(item.total_price ?? (item.unit_price || 0) * item.quantity) || 0;
        prodMap[pName].units += item.quantity;
      });
      const topProdArray = Object.values(prodMap).sort((a: any, b: any) => b.revenue - a.revenue).slice(0, 5);
      setTopProducts(topProdArray);

    } catch (err) {
      console.error('Error fetching analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Advanced Analytics</h1>
            <p className="text-gray-600 mt-1 md:mt-2 text-sm md:text-base">Detailed insights and performance metrics</p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-medium pr-8 cursor-pointer bg-white"
            >
              <option value="7days">Last 7 Days</option>
              <option value="30days">Last 30 Days</option>
              <option value="90days">Last 90 Days</option>
              <option value="year">This Year</option>
            </select>
            <button className="bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center">
              <i className="ri-download-line mr-2"></i>
              Export
            </button>
            <Link
              href="/admin"
              className="border-2 border-gray-300 hover:border-gray-400 text-gray-700 px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap text-center"
            >
              Back
            </Link>
          </div>
        </div>

        {/* Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 flex items-center justify-center bg-emerald-100 rounded-lg">
                <i className="ri-money-dollar-circle-line text-2xl text-emerald-700"></i>
              </div>
              <span className="text-emerald-700 font-semibold text-sm">Live</span>
            </div>
            <p className="text-sm text-gray-600 mb-1">Total Revenue</p>
            <p className="text-3xl font-bold text-gray-900">GH₵{metrics.revenue.toLocaleString()}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 flex items-center justify-center bg-blue-100 rounded-lg">
                <i className="ri-shopping-cart-line text-2xl text-blue-700"></i>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-1">Total Orders</p>
            <p className="text-3xl font-bold text-gray-900">{metrics.orders}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 flex items-center justify-center bg-purple-100 rounded-lg">
                <i className="ri-bar-chart-box-line text-2xl text-purple-700"></i>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-1">Avg. Order Value</p>
            <p className="text-3xl font-bold text-gray-900">GH₵{metrics.aov.toFixed(2)}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 flex items-center justify-center bg-amber-100 rounded-lg">
                <i className="ri-percent-line text-2xl text-amber-700"></i>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-1">Conversion Rate</p>
            {trackingConfigured ? (
              <>
                <p className="text-2xl font-bold text-gray-900">Tracking Active</p>
                <a
                  href="https://analytics.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-emerald-600 hover:text-emerald-700 mt-1 inline-block font-medium"
                >
                  View in Google Analytics <i className="ri-external-link-line"></i>
                </a>
              </>
            ) : (
              <>
                <p className="text-3xl font-bold text-gray-900">--</p>
                <Link
                  href="/admin/settings"
                  className="text-xs text-amber-600 hover:text-amber-700 mt-1 inline-block font-medium"
                >
                  Setup Tracking <i className="ri-arrow-right-line"></i>
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Charts */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Revenue & Performance Trends</h2>
            {/* Report Type Toggles omitted for brevity, hardcoded to Sales for now */}
          </div>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <AreaChart data={salesData.length > 0 ? salesData : [{ date: 'No Data', sales: 0 }]}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" stroke="#6b7280" />
                <YAxis stroke="#6b7280" />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="sales" stroke="#10b981" fillOpacity={1} fill="url(#colorSales)" name="Sales (GH₵)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Pie Chart */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Revenue by Category</h2>
            <div className="flex items-center justify-center mb-6">
              <div style={{ width: '100%', height: 250 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={categoryRevenue.length > 0 ? categoryRevenue : [{ name: 'No Data', value: 1 }]}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {categoryRevenue.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Top Products */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Top Performing Products</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-gray-100">
                  <tr>
                    <th className="text-left pb-3 text-sm font-semibold text-gray-600">Product</th>
                    <th className="text-right pb-3 text-sm font-semibold text-gray-600">Units</th>
                    <th className="text-right pb-3 text-sm font-semibold text-gray-600">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {topProducts.map((product, index) => (
                    <tr key={index}>
                      <td className="py-3 text-sm font-medium text-gray-900">{product.name}</td>
                      <td className="py-3 text-right text-sm text-gray-600">{product.units}</td>
                      <td className="py-3 text-right text-sm font-semibold text-emerald-600">GH₵{product.revenue.toLocaleString()}</td>
                    </tr>
                  ))}
                  {topProducts.length === 0 && <tr><td colSpan={3} className="text-center py-4 text-gray-500">No sales data yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
