'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import ProductCard from '@/components/ProductCard';
import type { HeroSlide } from '@/lib/homepage-hero';
import { heroSlidesWithImage } from '@/lib/homepage-hero';
import { fetchStorePromotions, salePrice } from '@/lib/promotions';

export default function HomePageClient({
  initialHeroSlides,
  initialHeroAutoplaySeconds,
}: {
  initialHeroSlides: HeroSlide[];
  initialHeroAutoplaySeconds: number;
}) {
  const [featuredProducts, setFeaturedProducts] = useState<any[]>([]);
  const [discountedProducts, setDiscountedProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  /** Only slides with an image URL render as backgrounds (CMS is the source of truth). */
  const heroSlides = useMemo(
    () => heroSlidesWithImage(initialHeroSlides),
    [initialHeroSlides]
  );
  const autoplaySeconds = initialHeroAutoplaySeconds;
  const [currentSlide, setCurrentSlide] = useState(0);
  const hoverRef = useRef(false);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);

        const limit = 8;

        // Strictly only show products the admin has explicitly marked as
        // featured. Previously the query ordered by `featured DESC` and let
        // unfeatured products fill the remaining slots up to the limit, so
        // unmarked products leaked onto the homepage when fewer than 8 were
        // featured. If nothing is featured, the section renders its empty
        // state instead.
        const { data: productsData, error: productsError } = await supabase
          .from('products')
          .select(`
            id, name, slug, price, compare_at_price, quantity, rating_avg, review_count, featured,
            product_images!product_id(url, position),
            product_variants(option2, option3, image_url, quantity)
          `)
          .eq('status', 'active')
          .eq('featured', true)
          .not('product_images.url', 'ilike', 'data:video%')
          .order('created_at', { ascending: false })
          .limit(limit)
          .order('position', { foreignTable: 'product_images', ascending: true })
          .limit(1, { foreignTable: 'product_images' });

        if (productsError) console.error('Error fetching home products:', productsError);

        if (productsData) {
          let promo = { storewideSaleEnabled: false, storewideSalePercent: 0, storewideSaleName: '' };
          try {
            promo = await fetchStorePromotions();
          } catch { /* ignore */ }

          const formatted = productsData.map(p => {
            const seen = new Set();
            const colors = (p.product_variants || [])
              .filter((v: any) => v.option2)
              .reduce((acc: any[], v: any) => {
                if (!seen.has(v.option2)) { seen.add(v.option2); acc.push({ name: v.option2, hex: v.option3 || null, image: v.image_url || null }); }
                return acc;
              }, []);
            const hasVariantInventory = (p.product_variants || []).length > 0;
            const effectiveStock = hasVariantInventory
              ? (p.product_variants || []).reduce((sum: number, v: any) => sum + (Number(v?.quantity) || 0), 0)
              : (Number(p.quantity) || 0);

            const list = Number(p.price) || 0;
            const onStorewide = promo.storewideSaleEnabled && promo.storewideSalePercent > 0;
            const displayPrice = onStorewide ? salePrice(list, promo) : list;
            const original = onStorewide
              ? Math.max(Number(p.compare_at_price) || 0, list)
              : p.compare_at_price;

            return {
              id: p.slug,
              name: p.name,
              price: displayPrice,
              originalPrice: original && original > displayPrice ? original : undefined,
              image: p.product_images?.find((img: any) => img.position === 0)?.url
                || p.product_images?.[0]?.url
                || '/placeholder-product.png',
              rating: p.rating_avg || 0,
              reviewCount: p.review_count || 0,
              slug: p.slug,
              inStock: effectiveStock > 0,
              colors: colors.length > 0 ? colors : undefined,
              badge: (onStorewide || (Number(p.compare_at_price) || 0) > list) ? 'Sale' : undefined,
            };
          });
          setFeaturedProducts(formatted);
        }

        const { data: discountData, error: discountError } = await supabase
          .from('products')
          .select(`
            id, name, slug, price, compare_at_price, quantity, rating_avg, review_count,
            product_images!product_id(url, position),
            product_variants(option2, option3, image_url, quantity)
          `)
          .eq('status', 'active')
          .not('compare_at_price', 'is', null)
          .gt('compare_at_price', 0)
          .not('product_images.url', 'ilike', 'data:video%')
          .order('created_at', { ascending: false })
          .limit(8)
          .order('position', { foreignTable: 'product_images', ascending: true })
          .limit(1, { foreignTable: 'product_images' });

        if (discountError) console.error('Error fetching discounted products:', discountError);

        if (discountData) {
          let promo = { storewideSaleEnabled: false, storewideSalePercent: 0 };
          try {
            promo = await fetchStorePromotions();
          } catch { /* ignore */ }

          const discounted = discountData
            .filter(p => p.compare_at_price > p.price || (promo.storewideSaleEnabled && promo.storewideSalePercent > 0))
            .map(p => {
              const seen = new Set();
              const colors = (p.product_variants || [])
                .filter((v: any) => v.option2)
                .reduce((acc: any[], v: any) => {
                  if (!seen.has(v.option2)) { seen.add(v.option2); acc.push({ name: v.option2, hex: v.option3 || null, image: v.image_url || null }); }
                  return acc;
                }, []);
              const hasVariantInventory = (p.product_variants || []).length > 0;
              const effectiveStock = hasVariantInventory
                ? (p.product_variants || []).reduce((sum: number, v: any) => sum + (Number(v?.quantity) || 0), 0)
                : (Number(p.quantity) || 0);

              const list = Number(p.price) || 0;
              const onStorewide = promo.storewideSaleEnabled && promo.storewideSalePercent > 0;
              const displayPrice = onStorewide ? salePrice(list, promo) : list;
              const original = onStorewide
                ? Math.max(Number(p.compare_at_price) || 0, list)
                : p.compare_at_price;

              return {
                id: p.slug,
                name: p.name,
                price: displayPrice,
                originalPrice: original && original > displayPrice ? original : undefined,
                image: p.product_images?.find((img: any) => img.position === 0)?.url
                  || p.product_images?.[0]?.url
                  || '/placeholder-product.png',
                rating: p.rating_avg || 0,
                reviewCount: p.review_count || 0,
                slug: p.slug,
                badge: 'Sale',
                inStock: effectiveStock > 0,
                colors: colors.length > 0 ? colors : undefined
              };
            });
          setDiscountedProducts(discounted);
        }

      } catch (err) {
        console.error('Unexpected error:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  useEffect(() => {
    if (heroSlides.length <= 1) return;
    const id = setInterval(() => {
      if (hoverRef.current) return;
      setCurrentSlide(prev => (prev + 1) % heroSlides.length);
    }, autoplaySeconds * 1000);
    return () => clearInterval(id);
  }, [heroSlides.length, autoplaySeconds]);

  useEffect(() => {
    if (currentSlide >= heroSlides.length) setCurrentSlide(0);
  }, [heroSlides.length, currentSlide]);

  const activeSlide = heroSlides[currentSlide];
  const isMultiSlide = heroSlides.length > 1;
  const showHero = heroSlides.length > 0 && !!activeSlide;

  return (
    <main className="min-h-screen bg-white">

      {showHero && (
      <section
        className="relative h-[70vh] lg:h-[85vh] overflow-hidden group"
        onMouseEnter={() => { hoverRef.current = true; }}
        onMouseLeave={() => { hoverRef.current = false; }}
      >
        {heroSlides.map((slide, idx) => {
          const isActive = idx === currentSlide;
          const imgSrc = slide.image;
          if (!imgSrc) return null;
          return (
            <div
              key={slide.id || `${imgSrc}-${idx}`}
              className={`absolute inset-0 transition-opacity duration-1000 ease-out ${isActive ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}
              aria-hidden={!isActive}
            >
              <div className="absolute inset-0 overflow-hidden bg-neutral-900">
                {imgSrc.startsWith('data:') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imgSrc}
                    alt={slide.title || 'Hy_stepper Collection'}
                    className="absolute inset-0 h-full w-full object-cover object-center"
                    style={{ objectPosition: 'center center' }}
                  />
                ) : (
                  <Image
                    src={imgSrc}
                    alt={slide.title || 'Hy_stepper Collection'}
                    fill
                    priority={idx === 0}
                    quality={idx === 0 ? 92 : 85}
                    sizes="100vw"
                    className="object-cover object-center"
                    style={{ objectPosition: 'center center' }}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60" />
              </div>
            </div>
          );
        })}

        <div
          key={`hero-content-${currentSlide}`}
          className="relative h-full flex flex-col items-center justify-end pb-20 lg:pb-28 px-4 text-center z-20"
        >
          {activeSlide.title && (
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-7xl text-white leading-tight mb-4 drop-shadow-lg animate-fade-in-up">
              {activeSlide.title}
            </h1>
          )}
          {activeSlide.subtitle && (
            <p className="text-lg lg:text-xl text-white/90 max-w-xl mb-8 drop-shadow-md animate-fade-in-up delay-100">
              {activeSlide.subtitle}
            </p>
          )}
          {activeSlide.button_text && activeSlide.button_link && (
            <div className="animate-fade-in-up delay-200">
              <Link
                href={activeSlide.button_link}
                className="group inline-flex items-center gap-3 bg-gold-500 hover:bg-gold-600 text-white px-10 py-4 rounded-full font-semibold text-lg transition-all shadow-xl hover:shadow-gold-500/50 hover:-translate-y-1 active:scale-95"
              >
                {activeSlide.button_text}
                <i className="ri-arrow-right-line transition-transform duration-300 group-hover:translate-x-1"></i>
              </Link>
            </div>
          )}
        </div>

        {isMultiSlide && (
          <>
            <button
              type="button"
              onClick={() => setCurrentSlide((prev) => (prev - 1 + heroSlides.length) % heroSlides.length)}
              className="hidden sm:flex absolute left-4 lg:left-8 top-1/2 -translate-y-1/2 z-30 w-11 h-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/25 backdrop-blur-sm border border-white/20 text-white transition-all opacity-0 group-hover:opacity-100"
              aria-label="Previous slide"
            >
              <i className="ri-arrow-left-s-line text-xl" />
            </button>
            <button
              type="button"
              onClick={() => setCurrentSlide((prev) => (prev + 1) % heroSlides.length)}
              className="hidden sm:flex absolute right-4 lg:right-8 top-1/2 -translate-y-1/2 z-30 w-11 h-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/25 backdrop-blur-sm border border-white/20 text-white transition-all opacity-0 group-hover:opacity-100"
              aria-label="Next slide"
            >
              <i className="ri-arrow-right-s-line text-xl" />
            </button>

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
              {heroSlides.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCurrentSlide(idx)}
                  aria-label={`Go to slide ${idx + 1}`}
                  className={`h-1.5 rounded-full transition-all ${idx === currentSlide ? 'w-8 bg-white' : 'w-4 bg-white/40 hover:bg-white/70'}`}
                />
              ))}
            </div>
          </>
        )}
      </section>
      )}

      <section className="relative overflow-hidden">

        <div className="bg-gray-900 animate-fade-in-up delay-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex flex-col md:flex-row md:items-center">

              <div className="py-4 md:py-0 md:pr-10 md:border-r border-white/10 md:w-56 flex-shrink-0">
                <div className="flex items-baseline gap-2 md:block">
                  <span className="text-gold-400 text-xs font-semibold tracking-[0.2em] uppercase md:block md:mb-1">Shop By</span>
                  <h2 className="text-xl md:text-2xl font-serif font-bold text-white">Heel Height</h2>
                </div>
              </div>

              <div className="flex-1 grid grid-cols-2 md:grid-cols-4 divide-x divide-white/10">
                {[
                  { label: 'Flat', value: 'flat', range: '0–1"', desc: 'Everyday ease', icon: 'ri-footprint-line' },
                  { label: 'Low', value: 'low', range: '2–2.5"', desc: 'Subtle lift', icon: 'ri-arrow-right-up-line' },
                  { label: 'Mid', value: 'mid', range: '3–3.5"', desc: 'Classic versatility', icon: 'ri-sort-asc' },
                  { label: 'High', value: 'high', range: '4"+', desc: 'Bold statement', icon: 'ri-vip-crown-line' },
                ].map((item) => (
                  <Link
                    key={item.value}
                    href={`/shop?heel_height=${item.value}`}
                    className="group relative flex items-center gap-4 px-6 py-8 md:py-10 transition-all duration-300 hover:bg-white/5"
                  >
                    <div className="absolute top-0 left-0 right-0 h-[3px] bg-gold-500 transform origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500"></div>

                    <div className="w-10 h-10 rounded-full bg-white/5 group-hover:bg-gold-500/20 flex items-center justify-center transition-all duration-300 flex-shrink-0">
                      <i className={`${item.icon} text-lg text-gray-400 group-hover:text-gold-400 transition-colors duration-300`}></i>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <h3 className="text-white font-semibold text-base group-hover:text-gold-400 transition-colors duration-300">{item.label}</h3>
                        <span className="text-[11px] text-gray-500 font-medium">{item.range}</span>
                      </div>
                      <p className="text-gray-500 text-xs group-hover:text-gray-400 transition-colors truncate">{item.desc}</p>
                    </div>

                    <i className="ri-arrow-right-s-line text-gray-600 group-hover:text-gold-400 ml-auto flex-shrink-0 opacity-0 group-hover:opacity-100 transform translate-x-[-8px] group-hover:translate-x-0 transition-all duration-300"></i>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border-b border-gray-100 animate-fade-in-up delay-300">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex flex-col md:flex-row md:items-center">

              <div className="py-4 md:py-0 md:pr-10 md:border-r border-gray-100 md:w-56 flex-shrink-0">
                <div className="flex items-baseline gap-2 md:block">
                  <span className="text-gold-600 text-xs font-semibold tracking-[0.2em] uppercase md:block md:mb-1">Shop By</span>
                  <h2 className="text-xl md:text-2xl font-serif font-bold text-gray-900">Size</h2>
                </div>
              </div>

              <div className="flex-1 flex items-center py-7 md:py-10 pl-0 md:pl-10 gap-3 overflow-x-auto scrollbar-hide">
                {[37, 38, 39, 40, 41].map((size) => (
                  <Link
                    key={size}
                    href={`/shop?size=${size}`}
                    className="group relative w-16 h-16 md:w-[72px] md:h-[72px] flex-shrink-0 flex items-center justify-center rounded-full border-2 border-gray-200 hover:border-gray-900 hover:bg-gray-900 transition-all duration-300 overflow-hidden"
                  >
                    <span className="text-base font-bold text-gray-800 group-hover:text-white transition-colors duration-300 relative z-10">{size}</span>
                  </Link>
                ))}

                <div className="h-10 w-px bg-gray-200 flex-shrink-0 mx-2 hidden md:block"></div>
                <Link
                  href="/size-guide"
                  className="flex-shrink-0 flex items-center gap-2 text-sm text-gray-400 hover:text-gold-600 transition-colors group whitespace-nowrap"
                >
                  <i className="ri-ruler-line text-base"></i>
                  <span className="font-medium hidden md:inline group-hover:underline decoration-gold-500 underline-offset-4">Size Guide</span>
                </Link>
              </div>

            </div>
          </div>
        </div>

      </section>

      <section className="py-16 lg:py-20 bg-gray-50" data-product-shop>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-end justify-between mb-10">
            <div className="animate-fade-in-up">
              <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-2">Trending Now</h2>
              <p className="text-gray-500">Our most loved styles this season</p>
            </div>
            <Link href="/shop" className="hidden sm:inline-flex items-center text-gold-600 hover:text-gold-700 font-semibold whitespace-nowrap cursor-pointer group transition-all">
              View All
              <i className="ri-arrow-right-line ml-2 transform group-hover:translate-x-1 transition-transform"></i>
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
              {[1, 2, 3, 4].map(idx => (
                <div key={idx} className="bg-white rounded-xl overflow-hidden shadow-sm h-96 animate-pulse">
                  <div className="h-64 bg-gray-200"></div>
                  <div className="p-4 space-y-3">
                    <div className="h-4 bg-gray-200 w-3/4"></div>
                    <div className="h-4 bg-gray-200 w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : featuredProducts.length > 0 ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
              {featuredProducts.map((product, idx) => (
                <div key={product.id} className="animate-fade-in-up" style={{ animationDelay: `${idx * 100}ms` }}>
                  <ProductCard {...product} priority={idx < 4} />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-500">No products found. Start adding products from the Admin Dashboard!</p>
            </div>
          )}

          <div className="text-center mt-10">
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 bg-gray-900 hover:bg-gold-600 text-white px-8 py-3.5 rounded-full font-medium transition-all hover:shadow-lg hover:-translate-y-1 whitespace-nowrap cursor-pointer group"
            >
              View All Products
              <i className="ri-arrow-right-line transform group-hover:translate-x-1 transition-transform"></i>
            </Link>
          </div>
        </div>
      </section>

      {discountedProducts.length > 0 && (
        <section className="py-16 lg:py-20 bg-gradient-to-br from-gold-50 to-amber-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-end justify-between mb-10">
              <div className="animate-fade-in-up">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-gold-100 text-gold-700 text-sm font-bold rounded-full mb-3 animate-pulse">
                  <i className="ri-fire-fill"></i>
                  Hot Deals
                </div>
                <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-2">Discounted Items</h2>
                <p className="text-gray-500">Grab these deals before they&apos;re gone</p>
              </div>
              <Link href="/sale" className="hidden sm:inline-flex items-center text-gold-600 hover:text-gold-700 font-semibold whitespace-nowrap cursor-pointer group transition-all">
                View All Deals
                <i className="ri-arrow-right-line ml-2 transform group-hover:translate-x-1 transition-transform"></i>
              </Link>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
              {discountedProducts.map((product, idx) => (
                <div key={product.id} className="animate-fade-in-up" style={{ animationDelay: `${idx * 100}ms` }}>
                  <ProductCard {...product} />
                </div>
              ))}
            </div>

            <div className="text-center mt-10 sm:hidden">
              <Link
                href="/sale"
                className="inline-flex items-center gap-2 bg-gold-600 hover:bg-gold-700 text-white px-8 py-3.5 rounded-full font-medium transition-all hover:shadow-lg hover:-translate-y-1 group"
              >
                View All Deals
                <i className="ri-arrow-right-line transform group-hover:translate-x-1 transition-transform"></i>
              </Link>
            </div>
          </div>
        </section>
      )}

    </main>
  );
}
