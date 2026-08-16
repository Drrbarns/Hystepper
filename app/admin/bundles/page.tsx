'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import AdminTableScroll from '@/components/admin/AdminTableScroll';

type ProductOption = {
  id: string;
  name: string;
  slug: string;
};

type BundleRow = {
  id: string;
  related_product_id: string;
  sort_order: number;
  related?: ProductOption | null;
};

export default function AdminBundlesPage() {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  const [addProductId, setAddProductId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    if (selectedProductId) {
      loadBundles(selectedProductId);
    } else {
      setBundles([]);
    }
  }, [selectedProductId]);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('products')
        .select('id, name, slug')
        .eq('status', 'active')
        .order('name');
      if (error) throw error;
      setProducts(data || []);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load products');
    } finally {
      setLoading(false);
    }
  };

  const loadBundles = async (productId: string) => {
    try {
      const { data, error } = await supabase
        .from('product_bundles')
        .select('id, related_product_id, sort_order, related:related_product_id(id, name, slug)')
        .eq('product_id', productId)
        .order('sort_order', { ascending: true });
      if (error) throw error;

      setBundles(
        (data || []).map((row: any) => ({
          id: row.id,
          related_product_id: row.related_product_id,
          sort_order: row.sort_order,
          related: Array.isArray(row.related) ? row.related[0] : row.related,
        }))
      );
    } catch (err) {
      console.error(err);
      toast.error('Failed to load bundles');
    }
  };

  const handleAdd = async () => {
    if (!selectedProductId || !addProductId) {
      toast.error('Select a product and a related item');
      return;
    }
    if (selectedProductId === addProductId) {
      toast.error('A product cannot be bundled with itself');
      return;
    }

    setSaving(true);
    try {
      const nextOrder = bundles.length;
      const { error } = await supabase.from('product_bundles').insert({
        product_id: selectedProductId,
        related_product_id: addProductId,
        sort_order: nextOrder,
      });
      if (error) throw error;
      setAddProductId('');
      await loadBundles(selectedProductId);
      toast.success('Related product added');
    } catch (err: any) {
      toast.error(err?.message?.includes('duplicate') ? 'Already in bundle list' : 'Failed to add product');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (bundleId: string) => {
    if (!selectedProductId) return;
    try {
      const { error } = await supabase.from('product_bundles').delete().eq('id', bundleId);
      if (error) throw error;
      await loadBundles(selectedProductId);
      toast.success('Removed from bundle');
    } catch (err) {
      console.error(err);
      toast.error('Failed to remove');
    }
  };

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Product Bundles</h1>
        <p className="text-gray-600 mt-2">
          Configure &ldquo;Frequently Bought Together&rdquo; suggestions shown on product detail pages.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <label className="block text-sm font-medium text-gray-700">Primary product</label>
        <select
          value={selectedProductId}
          onChange={(e) => setSelectedProductId(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
          disabled={loading}
        >
          <option value="">Select a product…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {selectedProduct && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Frequently Bought Together — {selectedProduct.name}
            </h2>
            <p className="text-sm text-gray-500 mt-1">Shown in order below on the storefront.</p>
          </div>

          {bundles.length === 0 ? (
            <p className="text-gray-500 text-sm">No bundle items yet. Add related products below.</p>
          ) : (
            <AdminTableScroll>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-4">#</th>
                    <th className="py-2 pr-4">Product</th>
                    <th className="py-2">Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {bundles.map((b, idx) => (
                    <tr key={b.id} className="border-b border-gray-100">
                      <td className="py-3 pr-4">{idx + 1}</td>
                      <td className="py-3 pr-4 font-medium">{b.related?.name || b.related_product_id}</td>
                      <td className="py-3">
                        <button
                          type="button"
                          onClick={() => handleRemove(b.id)}
                          className="text-red-600 hover:underline font-semibold"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableScroll>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-gray-100">
            <select
              value={addProductId}
              onChange={(e) => setAddProductId(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">Add related product…</option>
              {products
                .filter((p) => p.id !== selectedProductId && !bundles.some((b) => b.related_product_id === p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving || !addProductId}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-5 py-2 rounded-lg disabled:opacity-50"
            >
              Add to Bundle
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
