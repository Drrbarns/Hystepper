import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import type { Metadata } from 'next';
import ProductCard from '@/components/ProductCard';
import PageHero from '@/components/PageHero';
import { isModuleEnabledServer } from '@/lib/store-modules-server';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://hystepper.vercel.app';

function normalizeKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function resolveCategory(rawSlug: string) {
  const supabase = getSupabase();
  const slug = decodeURIComponent(rawSlug || '').trim();
  if (!slug) return null;

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, slug, description, image_url, metadata, status')
    .eq('status', 'active');

  const needle = normalizeKey(slug);
  return (
    (categories || []).find(
      (c) =>
        normalizeKey(c.slug) === needle ||
        normalizeKey(c.name) === needle ||
        (needle === 'women-s-sandals' && normalizeKey(c.slug) === 'shoes')
    ) || null
  );
}

async function getCategoryProducts(categoryId: string) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('products')
    .select(`
      id, name, slug, price, compare_at_price, quantity, rating_avg, review_count, is_new_arrival, on_sale,
      product_variants(option2, option3, quantity, image_url),
      product_images(url, position)
    `)
    .eq('status', 'active')
    .eq('category_id', categoryId)
    .order('created_at', { ascending: false });

  return (data || []).map((p) => {
    const seen = new Set<string>();
    const colors = (p.product_variants || [])
      .filter((v: { option2?: string | null }) => v.option2)
      .reduce(
        (
          acc: { name: string; hex: string | null; image?: string | null }[],
          v: { option2?: string | null; option3?: string | null; image_url?: string | null }
        ) => {
          const name = String(v.option2 || '');
          if (!seen.has(name)) {
            seen.add(name);
            acc.push({ name, hex: v.option3 || null, image: v.image_url || null });
          }
          return acc;
        },
        []
      );

    const hasVariantInventory = (p.product_variants || []).length > 0;
    const effectiveStock = hasVariantInventory
      ? (p.product_variants || []).reduce(
          (sum: number, v: { quantity?: number | null }) => sum + (Number(v?.quantity) || 0),
          0
        )
      : Number(p.quantity) || 0;

    const images = [...(p.product_images || [])].sort(
      (a: { position?: number }, b: { position?: number }) =>
        (a.position || 0) - (b.position || 0)
    );

    return {
      id: p.slug,
      name: p.name,
      price: p.price,
      originalPrice: p.compare_at_price,
      image: images[0]?.url || '/placeholder-product.png',
      rating: p.rating_avg || 0,
      reviewCount: p.review_count || 0,
      badge: p.is_new_arrival
        ? 'New'
        : p.on_sale || (p.compare_at_price && Number(p.compare_at_price) > Number(p.price))
          ? 'Sale'
          : undefined,
      inStock: effectiveStock > 0,
      colors: colors.length > 0 ? colors : undefined,
    };
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await resolveCategory(slug);
  const seoEnabled = await isModuleEnabledServer('on-page-seo');

  if (!category) {
    return { title: 'Category Not Found | Hy_stepper' };
  }

  const meta = (category.metadata || {}) as Record<string, unknown>;
  const seoTitle =
    seoEnabled && typeof meta.seo_title === 'string' ? meta.seo_title.trim() : '';
  const seoDescription =
    seoEnabled && typeof meta.seo_description === 'string'
      ? meta.seo_description.trim()
      : '';

  const title = seoTitle || `${category.name} — Shop Now`;
  const description =
    seoDescription ||
    (category.description?.trim() ||
      `Shop ${category.name} at Hy_stepper. Premium footwear & accessories delivered across Ghana.`);

  const canonicalUrl = `${SITE_URL}/categories/${category.slug}`;
  const image = category.image_url || `${SITE_URL}/og-share.png?v=20260813b`;

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${category.name} | Hy_stepper`,
      description,
      type: 'website',
      url: canonicalUrl,
      siteName: 'Hy_stepper',
      locale: 'en_GH',
      images: [{ url: image, width: 1200, height: 630, alt: category.name }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${category.name} | Hy_stepper`,
      description,
      images: [image],
    },
  };
}

export default async function CategoryLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await resolveCategory(slug);

  if (!category) notFound();

  const products = await getCategoryProducts(category.id);

  return (
    <main className="min-h-screen bg-white">
      <PageHero
        title={category.name}
        subtitle={
          category.description?.trim() ||
          `Browse our ${category.name} collection — curated styles delivered across Ghana.`
        }
      />

      {category.image_url && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 mb-8">
          <div className="relative h-48 md:h-64 rounded-2xl overflow-hidden shadow-lg">
            <Image
              src={category.image_url}
              alt={category.name}
              fill
              sizes="(max-width: 768px) 100vw, 1280px"
              className="object-cover"
              priority
            />
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <p className="text-gray-600">
            {products.length} product{products.length === 1 ? '' : 's'} in {category.name}
          </p>
          <Link
            href={`/shop?category=${encodeURIComponent(category.slug)}`}
            className="text-sm font-semibold text-emerald-700 hover:text-emerald-900"
          >
            Open in shop filters →
          </Link>
        </div>

        {products.length === 0 ? (
          <div className="text-center py-20 bg-gray-50 rounded-xl">
            <i className="ri-inbox-line text-5xl text-gray-300 mb-4"></i>
            <p className="text-xl text-gray-500 mb-6">No products in this category yet.</p>
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 bg-emerald-700 text-white px-6 py-3 rounded-lg font-semibold hover:bg-emerald-800 transition-colors"
            >
              Browse all products
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {products.map((product, idx) => (
              <ProductCard key={product.id} {...product} priority={idx < 4} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
