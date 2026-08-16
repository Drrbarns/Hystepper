'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import ProductCard from '@/components/ProductCard';

type FbtProps = {
  productId: string;
  categoryId?: string | null;
  excludeProductId?: string;
};

type CardProduct = {
  id: string;
  name: string;
  price: number;
  image: string;
  rating: number;
  reviewCount: number;
  inStock: boolean;
};

function mapProductRow(p: any): CardProduct {
  const stockFromVariants = (p.product_variants || []).reduce(
    (sum: number, v: { quantity?: number }) => sum + (Number(v?.quantity) || 0),
    0
  );
  const inStock =
    (p.product_variants || []).length > 0
      ? stockFromVariants > 0
      : (Number(p.quantity) || 0) > 0;

  return {
    id: p.slug,
    name: p.name,
    price: p.price,
    image: p.product_images?.[0]?.url || '/placeholder-product.png',
    rating: p.rating_avg || 0,
    reviewCount: 0,
    inStock,
  };
}

export default function FrequentlyBoughtTogether({
  productId,
  categoryId,
  excludeProductId,
}: FbtProps) {
  const [items, setItems] = useState<CardProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);

        const { data: moduleRow } = await supabase
          .from('store_modules')
          .select('enabled')
          .eq('id', 'product-bundles')
          .maybeSingle();

        if (!moduleRow?.enabled) {
          if (!cancelled) {
            setVisible(false);
            setItems([]);
          }
          return;
        }

        if (!cancelled) setVisible(true);

        const { data: bundleRows } = await supabase
          .from('product_bundles')
          .select(`
            sort_order,
            related:related_product_id(
              id, slug, name, price, quantity, rating_avg,
              product_variants(quantity),
              product_images(url, position)
            )
          `)
          .eq('product_id', productId)
          .order('sort_order', { ascending: true });

        const bundled = (bundleRows || [])
          .map((row: any) => {
            const rel = Array.isArray(row.related) ? row.related[0] : row.related;
            return rel ? mapProductRow(rel) : null;
          })
          .filter(Boolean) as CardProduct[];

        if (bundled.length > 0) {
          if (!cancelled) setItems(bundled.slice(0, 4));
          return;
        }

        if (!categoryId) {
          if (!cancelled) setItems([]);
          return;
        }

        const { data: related } = await supabase
          .from('products')
          .select('slug, name, price, quantity, rating_avg, product_variants(quantity), product_images(url, position)')
          .eq('category_id', categoryId)
          .eq('status', 'active')
          .neq('id', excludeProductId || productId)
          .not('product_images.url', 'ilike', 'data:video%')
          .order('position', { foreignTable: 'product_images', ascending: true })
          .limit(4)
          .limit(1, { foreignTable: 'product_images' });

        if (!cancelled) {
          setItems((related || []).map(mapProductRow));
        }
      } catch (err) {
        console.error('[FBT]', err);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [productId, categoryId, excludeProductId]);

  if (!visible || loading || items.length === 0) return null;

  return (
    <section className="py-24 bg-gray-50 border-t border-gray-100" data-product-fbt>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4 tracking-tight">
            Frequently Bought Together
          </h2>
          <div className="w-24 h-1 bg-gold-600 mx-auto rounded-full mb-6"></div>
          <p className="text-lg text-gray-600">Customers who bought this item also picked up</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {items.map((p, idx) => (
            <div key={p.id} className="animate-fade-in-up" style={{ animationDelay: `${idx * 100}ms` }}>
              <ProductCard {...p} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
