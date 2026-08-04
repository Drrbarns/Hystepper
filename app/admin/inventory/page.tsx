'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

export default function InventoryManagementPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInventory();
  }, []);

  const fetchInventory = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, slug, price, quantity, categories(name)')
        .eq('status', 'active')
        .order('name');

      if (error) throw error;

      if (data) {
        const mapped = data.map(p => {
          const stock = p.quantity || 0;
          let status = 'good';
          if (stock === 0) status = 'out';
          else if (stock < 10) status = 'low';

          return {
            id: p.id,
            name: p.name,
            sku: p.sku || 'N/A',
            slug: p.slug || null,
            category: (Array.isArray(p.categories) ? p.categories[0]?.name : (p.categories as any)?.name) || 'Uncategorized',
            currentStock: stock,
            reorderLevel: 10, // Default
            reorderQuantity: 50, // Default
            price: p.price || 0,
            cost: 0, // Not in DB
            status,
            supplier: 'Standard Supplier' // Default
          };
        });
        setProducts(mapped);
      }
    } catch (error) {
      console.error('Error fetching inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = stockFilter === 'all' ||
      (stockFilter === 'low' && product.status === 'low') ||
      (stockFilter === 'out' && product.status === 'out') ||
      (stockFilter === 'good' && product.status === 'good');
    return matchesSearch && matchesFilter;
  });

  const lowStockCount = products.filter(p => p.status === 'low').length;
  const outOfStockCount = products.filter(p => p.status === 'out').length;
  const totalStock = products.reduce((sum, p) => sum + (Number(p.currentStock) || 0), 0);
  const totalValue = products.reduce((sum, p) => sum + (p.currentStock * p.price), 0); // Using Price as Value

  const toggleProductSelection = (id: string) => {
    setSelectedProducts(prev =>
      prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
    );
  };

  const toggleAllProducts = () => {
    if (selectedProducts.length === filteredProducts.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(filteredProducts.map(p => p.id));
    }
  };

  const handleBulkRestock = async () => {
    const input = window.prompt(
      `Add how many units to each of the ${selectedProducts.length} selected product(s)?`,
      '10'
    );
    if (input == null) return;
    const qty = parseInt(input, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Enter a positive whole number');
      return;
    }

    // Products with variants keep their stock on the variants (a DB trigger
    // syncs the product total), so bulk-adding at product level would be
    // overwritten. Those must be restocked per-variant in the editor.
    const { data: variantRows } = await supabase
      .from('product_variants')
      .select('product_id')
      .in('product_id', selectedProducts);
    const withVariants = new Set((variantRows || []).map((v: any) => v.product_id));

    let updated = 0;
    const skippedNames: string[] = [];
    for (const id of selectedProducts) {
      const p = products.find(x => x.id === id);
      if (!p) continue;
      if (withVariants.has(id)) {
        skippedNames.push(p.name);
        continue;
      }
      const { error } = await supabase
        .from('products')
        .update({ quantity: (p.currentStock || 0) + qty })
        .eq('id', id);
      if (!error) updated++;
    }

    if (updated > 0) toast.success(`Added ${qty} units to ${updated} product(s)`);
    if (skippedNames.length > 0) {
      toast.info(
        `Skipped ${skippedNames.length} product(s) with size/colour variants — restock those from the product editor: ${skippedNames.slice(0, 3).join(', ')}${skippedNames.length > 3 ? '…' : ''}`
      );
    }
    setSelectedProducts([]);
    fetchInventory();
  };

  const handleExportCSV = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csvData = [
      ['SKU', 'Product Name', 'Category', 'Current Stock', 'Price', 'Status'],
      ...products.map(p => [
        p.sku,
        p.name,
        p.category,
        p.currentStock.toString(),
        p.price.toFixed(2),
        p.status
      ])
    ];

    const csvContent = csvData.map(row => row.map(esc).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success('Inventory exported');
  };

  // CSV stock import: rows of `SKU,quantity` (header optional). Sets the stock
  // to the given quantity — matches variants by SKU first, then products.
  const handleImportFile = async (file: File) => {
    setImporting(true);
    setImportReport([]);
    const report: string[] = [];
    try {
      const text = await file.text();
      const rows = text
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));

      // Skip a header row if the quantity column isn't numeric
      const dataRows = rows.filter((cols, idx) => !(idx === 0 && isNaN(parseInt(cols[1], 10))));

      let updated = 0;
      for (const cols of dataRows) {
        const skuVal = cols[0];
        const qty = parseInt(cols[1], 10);
        if (!skuVal || !Number.isFinite(qty) || qty < 0) {
          report.push(`Skipped row "${cols.join(',')}" — need SKU,quantity`);
          continue;
        }

        // Try variant SKU first (variant stock rolls up to the product total)
        const { data: variant } = await supabase
          .from('product_variants')
          .select('id')
          .eq('sku', skuVal)
          .maybeSingle();
        if (variant) {
          const { error } = await supabase
            .from('product_variants')
            .update({ quantity: qty })
            .eq('id', variant.id);
          if (error) report.push(`${skuVal}: failed — ${error.message}`);
          else updated++;
          continue;
        }

        const { data: prod } = await supabase
          .from('products')
          .select('id')
          .eq('sku', skuVal)
          .maybeSingle();
        if (prod) {
          const { error } = await supabase
            .from('products')
            .update({ quantity: qty })
            .eq('id', prod.id);
          if (error) report.push(`${skuVal}: failed — ${error.message}`);
          else updated++;
        } else {
          report.push(`${skuVal}: no product or variant with this SKU`);
        }
      }

      report.unshift(`${updated} item(s) updated.`);
      setImportReport(report);
      if (updated > 0) {
        toast.success(`Stock updated for ${updated} item(s)`);
        fetchInventory();
      }
    } catch (err: any) {
      toast.error(err?.message || 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Low Stock Alert Banner */}
        {(lowStockCount > 0 || outOfStockCount > 0) && (
          <div className={`mb-6 p-4 rounded-xl border flex items-start gap-3 ${
            outOfStockCount > 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
          }`}>
            <i className={`ri-alarm-warning-line text-2xl mt-0.5 ${outOfStockCount > 0 ? 'text-red-500' : 'text-amber-500'}`}></i>
            <div>
              <h3 className={`font-bold ${outOfStockCount > 0 ? 'text-red-900' : 'text-amber-900'}`}>
                Stock Alert
              </h3>
              <p className={`text-sm ${outOfStockCount > 0 ? 'text-red-700' : 'text-amber-700'}`}>
                {outOfStockCount > 0 && <span className="font-semibold">{outOfStockCount} product{outOfStockCount > 1 ? 's' : ''} out of stock. </span>}
                {lowStockCount > 0 && <span>{lowStockCount} product{lowStockCount > 1 ? 's' : ''} running low (under 10 units). </span>}
                <button onClick={() => setStockFilter(outOfStockCount > 0 ? 'out' : 'low')} className="underline font-semibold cursor-pointer">
                  View affected items
                </button>
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Inventory Management</h1>
            <p className="text-gray-600 mt-1 md:mt-2 text-sm md:text-base">Track stock levels, manage reorders, and forecast demand</p>
          </div>
          <Link
            href="/admin"
            className="bg-gray-900 hover:bg-gray-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap text-center"
          >
            Back to Dashboard
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Products</p>
                <p className="text-3xl font-bold text-gray-900">{products.length}</p>
              </div>
              <div className="w-12 h-12 flex items-center justify-center bg-blue-100 rounded-lg">
                <i className="ri-stack-line text-2xl text-blue-600"></i>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Stock</p>
                <p className="text-3xl font-bold text-indigo-600">{totalStock.toLocaleString()}</p>
              </div>
              <div className="w-12 h-12 flex items-center justify-center bg-indigo-100 rounded-lg">
                <i className="ri-archive-line text-2xl text-indigo-600"></i>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Low Stock Items</p>
                <p className="text-3xl font-bold text-amber-600">{lowStockCount}</p>
              </div>
              <div className="w-12 h-12 flex items-center justify-center bg-amber-100 rounded-lg">
                <i className="ri-alert-line text-2xl text-amber-600"></i>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Out of Stock</p>
                <p className="text-3xl font-bold text-red-600">{outOfStockCount}</p>
              </div>
              <div className="w-12 h-12 flex items-center justify-center bg-red-100 rounded-lg">
                <i className="ri-close-circle-line text-2xl text-red-600"></i>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Retail Value</p>
                <p className="text-3xl font-bold text-emerald-600">GH₵{totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
              <div className="w-12 h-12 flex items-center justify-center bg-emerald-100 rounded-lg">
                <i className="ri-money-dollar-circle-line text-2xl text-emerald-600"></i>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
            <div className="flex-1 max-w-md">
              <div className="relative">
                <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl flex items-center justify-center"></i>
                <input
                  type="text"
                  placeholder="Search by product name or SKU..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto">
                {['all', 'low', 'out', 'good'].map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setStockFilter(filter)}
                    className={`px-3 sm:px-4 py-2 rounded-md font-medium text-xs sm:text-sm transition-colors whitespace-nowrap cursor-pointer ${stockFilter === filter
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                      }`}
                  >
                    {filter === 'all' && 'All'}
                    {filter === 'low' && 'Low Stock'}
                    {filter === 'out' && 'Out (0)'}
                    {filter === 'good' && 'In Stock'}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowImportModal(true)}
                className="bg-emerald-700 hover:bg-emerald-800 text-white px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg font-semibold transition-colors flex items-center space-x-1.5 sm:space-x-2 whitespace-nowrap cursor-pointer text-sm"
              >
                <i className="ri-upload-line"></i>
                <span>Import</span>
              </button>

              <button
                onClick={handleExportCSV}
                className="border-2 border-gray-300 hover:border-gray-400 text-gray-700 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg font-semibold transition-colors flex items-center space-x-1.5 sm:space-x-2 whitespace-nowrap cursor-pointer text-sm"
              >
                <i className="ri-download-line"></i>
                <span>Export</span>
              </button>
            </div>
          </div>

          {selectedProducts.length > 0 && (
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
              <p className="text-emerald-800 font-medium text-sm">
                {selectedProducts.length} product{selectedProducts.length > 1 ? 's' : ''} selected
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBulkRestock}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer text-sm"
                >
                  Bulk Restock
                </button>
                <button
                  onClick={() => setSelectedProducts([])}
                  className="text-gray-600 hover:text-gray-900 font-medium whitespace-nowrap cursor-pointer text-sm"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-left">
                    <input
                      type="checkbox"
                      checked={selectedProducts.length === filteredProducts.length && filteredProducts.length > 0}
                      onChange={toggleAllProducts}
                      className="w-5 h-5 text-emerald-700 rounded cursor-pointer"
                    />
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Product</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">SKU</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Category</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Stock</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Retail Value</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Status</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr><td colSpan={8} className="p-10 text-center text-gray-500">Loading inventory...</td></tr>
                ) : filteredProducts.length === 0 ? (
                  <tr><td colSpan={8} className="p-10 text-center text-gray-500">No products found.</td></tr>
                ) : (
                  filteredProducts.map((product) => (
                    <tr key={product.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedProducts.includes(product.id)}
                          onChange={() => toggleProductSelection(product.id)}
                          className="w-5 h-5 text-emerald-700 rounded cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-semibold text-gray-900">{product.name}</p>
                          <p className="text-sm text-gray-500">{product.supplier}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-700">{product.sku}</td>
                      <td className="px-6 py-4 text-gray-700">{product.category}</td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-gray-900">{product.currentStock}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-gray-900">
                          GH₵{(product.currentStock * product.price).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {product.status === 'good' && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-emerald-100 text-emerald-700 whitespace-nowrap">
                            <i className="ri-checkbox-circle-fill mr-1"></i>
                            In Stock
                          </span>
                        )}
                        {product.status === 'low' && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-700 whitespace-nowrap">
                            <i className="ri-alert-fill mr-1"></i>
                            Low Stock
                          </span>
                        )}
                        {product.status === 'out' && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700 whitespace-nowrap">
                            <i className="ri-close-circle-fill mr-1"></i>
                            Out of Stock
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => router.push(`/admin/products/${product.id}`)}
                            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-emerald-700 transition-colors cursor-pointer"
                            title="Edit product"
                            aria-label={`Edit ${product.name}`}
                          >
                            <i className="ri-edit-line text-lg"></i>
                          </button>
                          <button
                            onClick={() => router.push(`/admin/products/${product.id}?tab=history`)}
                            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-purple-700 transition-colors cursor-pointer"
                            title="Stock history"
                            aria-label={`Stock history for ${product.name}`}
                          >
                            <i className="ri-history-line text-lg"></i>
                          </button>
                          <button
                            onClick={() => {
                              if (product.slug) {
                                window.open(`/product/${product.slug}`, '_blank', 'noopener');
                              } else {
                                router.push(`/admin/products/${product.id}`);
                              }
                            }}
                            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 transition-colors cursor-pointer"
                            title="View on storefront"
                            aria-label={`View ${product.name} on storefront`}
                          >
                            <i className="ri-eye-line text-lg"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !importing && setShowImportModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Import Stock (CSV)</h2>
              <button
                onClick={() => setShowImportModal(false)}
                disabled={importing}
                className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-900 cursor-pointer"
                aria-label="Close"
              >
                <i className="ri-close-line text-xl"></i>
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-3">
              Upload a CSV with two columns: <span className="font-mono font-semibold">SKU,quantity</span>.
              Stock is <span className="font-semibold">set</span> to the given quantity. Variant SKUs are
              matched first, then product SKUs.
            </p>
            <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 mb-4">{`SKU,quantity
HS-001-38,12
HS-002,5`}</pre>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              disabled={importing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
              }}
              className="block w-full text-sm text-gray-700 file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-emerald-700 file:text-white file:font-semibold file:cursor-pointer cursor-pointer"
            />

            {importing && (
              <p className="mt-4 text-sm text-gray-600 flex items-center gap-2">
                <i className="ri-loader-4-line animate-spin"></i> Importing…
              </p>
            )}

            {importReport.length > 0 && (
              <div className="mt-4 max-h-48 overflow-y-auto bg-gray-50 border border-gray-200 rounded-lg p-3">
                {importReport.map((line, i) => (
                  <p key={i} className={`text-xs ${i === 0 ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
