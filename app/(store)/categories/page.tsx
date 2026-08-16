import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import PageHero from '@/components/PageHero';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://hystepper.vercel.app';

export const metadata: Metadata = {
  title: 'Shop by Category',
  description:
    'Explore Hy_stepper collections — heels, sneakers, bags and accessories. Find exactly what you are looking for.',
  alternates: { canonical: `${SITE_URL}/categories` },
  openGraph: {
    title: 'Shop by Category | Hy_stepper',
    description: 'Explore our curated collections and find exactly what you are looking for.',
    type: 'website',
    url: `${SITE_URL}/categories`,
    siteName: 'Hy_stepper',
    locale: 'en_GH',
  },
};

// Always fresh: the catalogue is small, admins can reorder categories
// at any time, and a stale ISR cache here was causing reorders to take
// up to 5 minutes to surface. Render cost is negligible.
export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const { data: categoriesData } = await supabase
    .from('categories')
    .select(`
      id,
      name,
      slug,
      description,
      image_url,
      position
    `)
    .eq('status', 'active')
    .order('position', { ascending: true });

  // Palette to cycle through for visual variety since DB doesn't have colors
  const palette = [
    { color: 'from-emerald-500 to-emerald-700', icon: 'ri-store-2-line' },
    { color: 'from-blue-500 to-blue-700', icon: 'ri-shopping-bag-3-line' },
    { color: 'from-purple-500 to-purple-700', icon: 'ri-t-shirt-line' },
    { color: 'from-amber-500 to-amber-700', icon: 'ri-home-smile-line' },
    { color: 'from-rose-500 to-rose-700', icon: 'ri-heart-line' },
    { color: 'from-indigo-500 to-indigo-700', icon: 'ri-star-smile-line' },
  ];

  const categories = categoriesData?.map((c, i) => {
    const style = palette[i % palette.length];
    return {
      ...c,
      image: c.image_url || '/placeholder-product.png',
      color: style.color,
      icon: style.icon,
      // Optional: Fetch product count if needed, currently skipping for performance/simplicity
      productCount: 'Browse',
    };
  }) || [];

  return (
    <div className="min-h-screen bg-white">
      <PageHero
        title="Shop by Category"
        subtitle="Explore our curated collections and find exactly what you're looking for"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {categories.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {categories.map((category, idx) => (
              <Link
                key={category.id}
                href={`/categories/${category.slug}`}
                className="group bg-white border border-transparent rounded-2xl overflow-hidden shadow-sm hover:shadow-2xl hover:border-gold-500/30 transition-all duration-300 hover:-translate-y-1 cursor-pointer animate-fade-in-up"
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                <div className="relative h-48 overflow-hidden">
                  <Image
                    src={category.image || '/placeholder-product.png'}
                    alt={category.name}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover group-hover:scale-110 transition-transform duration-500"
                  />
                  <div className={`absolute inset-0 bg-gradient-to-t ${category.color} opacity-0 group-hover:opacity-20 transition-opacity`}></div>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-12 h-12 bg-gradient-to-br ${category.color} rounded-full flex items-center justify-center`}>
                      <i className={`${category.icon} text-2xl text-white`}></i>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">{category.name}</h3>
                      <p className="text-sm text-gray-500">Collection</p>
                    </div>
                  </div>
                  <p className="text-gray-600 leading-relaxed text-sm mb-4 line-clamp-2">
                    {category.description || 'Explore our exclusive collection in this category.'}
                  </p>
                  <div className="flex items-center text-gold-600 font-medium text-sm group-hover:gap-2 transition-all">
                    <span>Browse Collection</span>
                    <i className="ri-arrow-right-line ml-2"></i>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-gray-50 rounded-xl">
            <i className="ri-inbox-line text-5xl text-gray-300 mb-4"></i>
            <p className="text-xl text-gray-500">No categories found.</p>
          </div>
        )}
      </div>

      <div className="relative bg-gray-900 overflow-hidden py-16">
        <div className="absolute inset-0 opacity-10 bg-[linear-gradient(45deg,rgba(255,255,255,.05)_25%,transparent_25%,transparent_75%,rgba(255,255,255,.05)_75%)] bg-[length:20px_20px]"></div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Can&apos;t Find What You&apos;re Looking For?</h2>
          <p className="text-lg md:text-xl text-gold-100 mb-8 leading-relaxed">
            Try our advanced search or contact our team for personalised product recommendations
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 bg-white text-gray-900 px-8 py-4 rounded-full font-semibold hover:bg-gold-50 transition-colors whitespace-nowrap"
            >
              <i className="ri-search-line"></i>
              Search All Products
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 bg-gold-600 text-white px-8 py-4 rounded-full font-semibold hover:bg-gold-700 transition-colors whitespace-nowrap"
            >
              <i className="ri-customer-service-line"></i>
              Contact Support
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
