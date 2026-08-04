'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ProductCard from '@/components/ProductCard';
import PageHero from '@/components/PageHero';
import { supabase } from '@/lib/supabase';

type SaleProduct = {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  rating: number;
  inStock: boolean;
  category?: string;
  colors?: { name: string; hex: string | null; image?: string | null }[];
};

export default function SalePage() {
  const [products, setProducts] = useState<SaleProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSaleProducts() {
      setLoading(true);
      try {
        // A product is "on sale" when its compare-at price is above the
        // current price (same rule as the homepage "Discounted Items"
        // section) — OR when the admin explicitly flagged it with on_sale.
        // Filtering only on the on_sale flag hid discounted products the
        // admin never flagged, which is why /sale showed a single item.
        const { data, error } = await supabase
          .from('products')
          .select(`
            id, name, slug, price, compare_at_price, on_sale, quantity, rating_avg,
            categories(name, slug),
            product_images!product_id(url, position),
            product_variants(option2, option3, image_url, quantity)
          `)
          .eq('status', 'active')
          .not('product_images.url', 'ilike', 'data:video%')
          .order('position', { foreignTable: 'product_images', ascending: true })
          .limit(1, { foreignTable: 'product_images' })
          .order('updated_at', { ascending: false });

        if (error) throw error;

        const saleRows = (data || []).filter(
          (p: any) => p.on_sale || (Number(p.compare_at_price) || 0) > (Number(p.price) || 0)
        );

        const formatted: SaleProduct[] = saleRows.map((p: any) => {
          const seen = new Set<string>();
          const colors = (p.product_variants || [])
            .filter((v: any) => v.option2)
            .reduce((acc: any[], v: any) => {
              if (!seen.has(v.option2)) {
                seen.add(v.option2);
                acc.push({ name: v.option2, hex: v.option3 || null, image: v.image_url || null });
              }
              return acc;
            }, []);

          const hasVariantInventory = (p.product_variants || []).length > 0;
          const effectiveStock = hasVariantInventory
            ? (p.product_variants || []).reduce(
                (sum: number, v: any) => sum + (Number(v?.quantity) || 0),
                0,
              )
            : Number(p.quantity) || 0;

          const cat = Array.isArray(p.categories) ? p.categories[0] : p.categories;

          return {
            id: p.slug,
            name: p.name,
            price: Number(p.price) || 0,
            originalPrice: p.compare_at_price ? Number(p.compare_at_price) : undefined,
            image:
              p.product_images?.[0]?.url || '/placeholder-product.png',
            rating: Number(p.rating_avg) || 0,
            inStock: effectiveStock > 0,
            category: cat?.name,
            colors: colors.length > 0 ? colors : undefined,
          };
        });

        setProducts(formatted);
      } catch (err) {
        console.error('Error fetching sale products:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchSaleProducts();
  }, []);

  return (
    <main className="min-h-screen bg-white">
      <PageHero
        title="On Sale"
        subtitle="Limited-time deals on our hand-picked favourites"
      />

      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="bg-gray-100 rounded-xl aspect-[4/5] animate-pulse"
                ></div>
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-20 max-w-md mx-auto">
              <div className="w-20 h-20 flex items-center justify-center mx-auto mb-6 bg-rose-50 rounded-full">
                <i className="ri-price-tag-3-line text-4xl text-rose-500"></i>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">No sales right now</h3>
              <p className="text-gray-600 mb-8">
                Check back soon — new deals drop regularly. In the meantime, browse the full
                collection.
              </p>
              <Link
                href="/shop"
                className="inline-flex items-center bg-gray-900 hover:bg-gold-600 text-white px-6 py-3 rounded-lg font-medium transition-colors"
              >
                Shop All Products
              </Link>
            </div>
          ) : (
            <>
              <p className="text-gray-600 mb-8">
                Showing <span className="font-semibold text-gray-900">{products.length}</span>{' '}
                {products.length === 1 ? 'product' : 'products'} on sale
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {products.map((product, idx) => (
                  <div
                    key={product.id}
                    className="animate-fade-in-up"
                    style={{ animationDelay: `${(idx % 9) * 50}ms` }}
                  >
                    <ProductCard {...product} badge="Sale" />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
