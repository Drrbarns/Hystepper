'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ProductCard from '@/components/ProductCard';
import { supabase } from '@/lib/supabase';
import PageHero from '@/components/PageHero';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';

function ShopContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // State
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([{ id: 'all', name: 'All Products', count: 0 }]);
  const [loading, setLoading] = useState(true);
  const [totalProducts, setTotalProducts] = useState(0);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [priceRange, setPriceRange] = useState([0, 5000]);
  const [selectedRating, setSelectedRating] = useState(0);
  const [selectedColor, setSelectedColor] = useState('');
  const [availableColors, setAvailableColors] = useState<string[]>([]);
  /** True once we know whether any active product has approved reviews. */
  const [hasRatedProducts, setHasRatedProducts] = useState<boolean | null>(null);
  const [sortBy, setSortBy] = useState('popular');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  useBodyScrollLock(isFilterOpen);
  const [page, setPage] = useState(1);
  // 12 keeps every row full on both the 2-column (mobile) and 3-column
  // (desktop) grids — 12 is divisible by 2 and 3, so there are never orphan
  // tiles in the last row. (9 left a lopsided row on the 2-column mobile view.)
  const productsPerPage = 12;

  // Monotonic counter used to discard out-of-order Supabase responses. Without
  // it, switching categories quickly (e.g. All → Shoes) could let the slower
  // "All" response land after the "Shoes" response and repaint the grid with
  // every product — which looked like the category filter "leaking".
  const fetchSeqRef = useRef(0);

  // Active URL-based filters
  const activeHeelHeight = searchParams.get('heel_height');
  const activeSize = searchParams.get('size');
  const activeSearch = searchParams.get('search');
  const activeColorParam = searchParams.get('color');

  const heelLabels: Record<string, string> = { flat: 'Flat (0–1")', low: 'Low (2–2.5")', mid: 'Mid (3–3.5")', high: 'High (4"+)' };

  const hasActiveFilters =
    selectedCategory !== 'all' ||
    priceRange[1] < 5000 ||
    selectedRating > 0 ||
    !!selectedColor ||
    !!activeHeelHeight ||
    !!activeSize ||
    !!activeSearch ||
    (sortBy !== 'popular' && sortBy !== '');

  function removeFilter(key: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(key);
    if (key === 'color') setSelectedColor('');
    if (key === 'rating') setSelectedRating(0);
    const qs = params.toString();
    router.push(qs ? `/shop?${qs}` : '/shop');
  }

  function setRatingFilter(rating: number) {
    const next = rating === selectedRating ? 0 : rating;
    setSelectedRating(next);
    setPage(1);
    const params = new URLSearchParams(searchParams.toString());
    if (next > 0) params.set('rating', String(next));
    else params.delete('rating');
    const qs = params.toString();
    router.replace(qs ? `/shop?${qs}` : '/shop', { scroll: false });
    // On mobile the filter drawer covers the grid — close it so shoppers see results.
    setIsFilterOpen(false);
  }

  function clearAllFilters() {
    setSelectedCategory('all');
    setPriceRange([0, 5000]);
    setSelectedRating(0);
    setSelectedColor('');
    setSortBy('popular');
    setPage(1);
    setIsFilterOpen(false);
    router.push('/shop');
  }

  function setCategoryFilter(slug: string) {
    setSelectedCategory(slug);
    setPage(1);
    const params = new URLSearchParams(searchParams.toString());
    if (slug === 'all') params.delete('category');
    else params.set('category', slug);
    const qs = params.toString();
    router.replace(qs ? `/shop?${qs}` : '/shop', { scroll: false });
  }

  // Initialize from URL params
  useEffect(() => {
    const category = searchParams.get('category');
    const sort = searchParams.get('sort');
    const color = searchParams.get('color');
    const ratingParam = parseInt(searchParams.get('rating') || '0', 10);

    setSelectedCategory(category || 'all');
    if (sort) setSortBy(sort);
    else if (![...searchParams.keys()].length) setSortBy('popular');
    setSelectedColor(color || '');
    setSelectedRating([1, 2, 3, 4, 5].includes(ratingParam) ? ratingParam : 0);
  }, [searchParams]);

  // Whether any product has real reviews (drives rating-filter availability)
  useEffect(() => {
    async function checkRated() {
      const { count, error } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .gt('review_count', 0);
      if (error) {
        console.error('Failed to check rated products:', error);
        setHasRatedProducts(false);
        return;
      }
      setHasRatedProducts((count || 0) > 0);
    }
    void checkRated();
  }, []);

  // Distinct in-stock colours for the filter sidebar
  useEffect(() => {
    async function loadColors() {
      const { data } = await supabase
        .from('product_variants')
        .select('option2')
        .gt('quantity', 0)
        .not('option2', 'is', null)
        .neq('option2', '');
      if (!data) return;
      const seen = new Map<string, string>();
      for (const row of data) {
        const raw = String(row.option2 || '').trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        if (!seen.has(key)) seen.set(key, raw);
      }
      setAvailableColors([...seen.values()].sort((a, b) => a.localeCompare(b)));
    }
    void loadColors();
  }, []);

  // Fetch Categories
  useEffect(() => {
    async function fetchCategories() {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, slug, parent_id');

      if (data) {
        setCategories(data);
      }
    }
    fetchCategories();
  }, []);

  // Fetch Products
  useEffect(() => {
    const seq = ++fetchSeqRef.current;
    async function fetchProducts() {
      setLoading(true);
      try {
        let query = supabase
          .from('products')
          .select(`
            id, name, slug, price, compare_at_price, quantity, rating_avg, review_count, heel_height, product_code, style_name,
            sales_count, is_new_arrival, on_sale,
            categories!inner(name, slug),
            product_images!product_id(url, position),
            product_variants(option2, option3, image_url, quantity)
          `, { count: 'exact' })
          .eq('status', 'active')
          .not('product_images.url', 'ilike', 'data:video%')
          .order('position', { foreignTable: 'product_images', ascending: true })
          .limit(1, { foreignTable: 'product_images' });

        const search = searchParams.get('search');

        // Search - matches name, product_code, or style_name
        if (search) {
          query = query.or(`name.ilike.%${search}%,product_code.ilike.%${search}%,style_name.ilike.%${search}%`);
        }

        // Category Filter with Subcategories.
        //
        // We filter on the products' own `category_id` column (plus any child
        // category ids) rather than the embedded `categories.slug` relation.
        // Filtering by the direct foreign key is unambiguous and avoids the
        // edge cases of filtering through an `!inner` embed.
        if (selectedCategory !== 'all') {
          const normalize = (v: string) =>
            String(v || '')
              .toLowerCase()
              .replace(/&/g, ' and ')
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');
          const needle = normalize(selectedCategory);
          // Accept slug, display name, or legacy slugs (e.g. women-s-sandals → Shoes).
          const categoryObj = categories.find((c) => {
            return (
              normalize(c.slug) === needle ||
              normalize(c.name) === needle ||
              (needle === 'women-s-sandals' && normalize(c.slug) === 'shoes')
            );
          });

          if (categoryObj) {
            // Selected category + its direct children (1 level of nesting).
            const targetIds = [
              categoryObj.id,
              ...categories
                .filter(c => c.parent_id === categoryObj.id)
                .map(c => c.id),
            ];
            query = query.in('category_id', targetIds);
          } else {
            // Categories not loaded yet — fall back to matching on the embedded
            // slug. Once `categories` resolves, the effect re-runs (it's a
            // dependency) and switches to the precise id-based filter above.
            query = query.eq('categories.slug', selectedCategory);
          }
        }

        // Price Filter
        if (priceRange[1] < 5000) { // Only apply if not max default
          query = query.gte('price', priceRange[0]).lte('price', priceRange[1]);
        }

        // Rating filter — products with approved reviews at/above the threshold.
        // Unrated products (review_count = 0) are excluded on purpose.
        if (selectedRating > 0) {
          query = query
            .gt('review_count', 0)
            .gte('rating_avg', selectedRating);
        }

        // Heel Height Filter (from URL params)
        const heelParam = searchParams.get('heel_height');
        if (heelParam) {
          const heelMap: Record<string, string> = {
            'flat': 'Flat',
            'low': 'Low',
            'mid': 'Mid',
            'high': 'High'
          };
          if (heelMap[heelParam]) {
            query = query.ilike('heel_height', heelMap[heelParam]);
          }
        }

        // Size Filter — get product IDs that have *in-stock* variants with the
        // matching size. Variant names follow the "Size / Colour" pattern
        // (e.g. "37 / Black"), so an exact `name = '37'` match never finds
        // anything. The canonical size lives in `option1`; we also match
        // `name LIKE '37 / %'` and the bare `name = '37'` case to cover legacy
        // single-option variants where option1 may not be populated.
        const sizeParam = searchParams.get('size')?.trim();
        if (sizeParam) {
          // Prefer option1; also match legacy "36 / Black" / bare "36" names.
          // Use separate filters (not a raw .or string) so spaces in "36 / %" parse correctly.
          const safeSize = sizeParam.replace(/[,%]/g, '');
          const [byOption, byExactName, byPrefixedName] = await Promise.all([
            supabase.from('product_variants').select('product_id').gt('quantity', 0).eq('option1', safeSize),
            supabase.from('product_variants').select('product_id').gt('quantity', 0).eq('name', safeSize),
            supabase.from('product_variants').select('product_id').gt('quantity', 0).ilike('name', `${safeSize} / %`),
          ]);
          const productIds = [...new Set(
            [...(byOption.data || []), ...(byExactName.data || []), ...(byPrefixedName.data || [])]
              .map((v: any) => v.product_id)
              .filter(Boolean),
          )];

          if (productIds.length > 0) {
            query = query.in('id', productIds);
          } else {
            query = query.in('id', ['00000000-0000-0000-0000-000000000000']);
          }
        }

        // Colour filter — match option2 case-insensitively (DB has "Black" / "Black ").
        const colorFilter = (selectedColor || searchParams.get('color') || '').trim();
        if (colorFilter) {
          const { data: colorVariants } = await supabase
            .from('product_variants')
            .select('product_id, option2')
            .gt('quantity', 0)
            .not('option2', 'is', null);

          const matchedIds = [
            ...new Set(
              (colorVariants || [])
                .filter((v: any) => String(v.option2 || '').trim().toLowerCase() === colorFilter.toLowerCase())
                .map((v: any) => v.product_id)
            ),
          ];

          if (matchedIds.length > 0) {
            query = query.in('id', matchedIds);
          } else {
            query = query.in('id', ['00000000-0000-0000-0000-000000000000']);
          }
        }

        // Sorting
        switch (sortBy) {
          case 'price-low':
            query = query.order('price', { ascending: true });
            break;
          case 'price-high':
            query = query.order('price', { ascending: false });
            break;
          case 'rating':
            // Only products with real reviews; then highest average, then most reviews
            query = query
              .gt('review_count', 0)
              .order('rating_avg', { ascending: false })
              .order('review_count', { ascending: false });
            break;
          case 'new':
          case 'newest':
            // Curated New Arrivals (admin checkbox), newest first
            query = query
              .eq('is_new_arrival', true)
              .order('created_at', { ascending: false });
            break;
          case 'recent':
            query = query.order('created_at', { ascending: false });
            break;
          case 'popular':
          default:
            // Units sold (paid orders), then recency as tie-breaker
            query = query
              .order('sales_count', { ascending: false })
              .order('created_at', { ascending: false });
            break;
        }

        // Pagination
        const from = (page - 1) * productsPerPage;
        const to = from + productsPerPage - 1;
        query = query.range(from, to);

        const { data, count, error } = await query;

        // A newer fetch has started since this one — discard these results so a
        // slow response can't overwrite the current filter's grid.
        if (seq !== fetchSeqRef.current) return;

        if (error) throw error;

        if (data) {
          const formattedProducts = data.map(p => {
            const seen = new Set();
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
              ? (p.product_variants || []).reduce((sum: number, v: any) => sum + (Number(v?.quantity) || 0), 0)
              : (Number(p.quantity) || 0);

            return {
              id: p.slug,
              name: p.name,
              price: p.price,
              originalPrice: p.compare_at_price,
              image: p.product_images?.[0]?.url || '/placeholder-product.png',
              rating: p.rating_avg || 0,
              reviewCount: p.review_count || 0,
              badge: p.is_new_arrival
                ? 'New'
                : (p.on_sale || (p.compare_at_price > p.price))
                  ? 'Sale'
                  : undefined,
              inStock: effectiveStock > 0,
              category: Array.isArray(p.categories) ? p.categories[0]?.name : p.categories?.name,
              colors: colors.length > 0 ? colors : undefined
            };
          });
          setProducts(formattedProducts);
          setTotalProducts(count || 0);
        }
      } catch (err) {
        if (seq === fetchSeqRef.current) console.error('Error fetching products:', err);
      } finally {
        // Only the most recent fetch is allowed to clear the loading state.
        if (seq === fetchSeqRef.current) setLoading(false);
      }
    }

    fetchProducts();
  }, [selectedCategory, priceRange, selectedRating, selectedColor, sortBy, page, searchParams, categories]);

  const totalPages = Math.ceil(totalProducts / productsPerPage);

  return (
    <main className="min-h-screen bg-white">
      <PageHero
        title={activeHeelHeight ? `${heelLabels[activeHeelHeight] || activeHeelHeight} Heels` : activeSize ? `Size ${activeSize}` : 'Shop All Products'}
        subtitle={activeHeelHeight || activeSize ? 'Filtered results from our collection' : 'Discover our curated collection of premium goods'}
      />

      {/* Active Filter Badges */}
      {hasActiveFilters && (
        <div className="bg-gold-50 border-b border-gold-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-gray-500 font-medium">Active filters:</span>
              {selectedCategory !== 'all' && (
                <button
                  onClick={() => {
                    setSelectedCategory('all');
                    setPage(1);
                    removeFilter('category');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gold-200 rounded-full text-sm font-medium text-gold-700 hover:bg-gold-100 transition-colors group"
                >
                  Category: {categories.find((c) => c.slug === selectedCategory)?.name || selectedCategory}
                  <i className="ri-close-line text-gray-400 group-hover:text-gold-700 transition-colors"></i>
                </button>
              )}
              {selectedColor && (
                <button
                  onClick={() => {
                    setSelectedColor('');
                    setPage(1);
                    removeFilter('color');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gold-200 rounded-full text-sm font-medium text-gold-700 hover:bg-gold-100 transition-colors group"
                >
                  <i className="ri-palette-line text-xs"></i>
                  Colour: {selectedColor}
                  <i className="ri-close-line text-gray-400 group-hover:text-gold-700 transition-colors"></i>
                </button>
              )}
              {activeHeelHeight && (
                <button
                  onClick={() => removeFilter('heel_height')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gold-200 rounded-full text-sm font-medium text-gold-700 hover:bg-gold-100 transition-colors group"
                >
                  <i className="ri-footprint-line text-xs"></i>
                  Heel: {heelLabels[activeHeelHeight] || activeHeelHeight}
                  <i className="ri-close-line text-gray-400 group-hover:text-gold-700 transition-colors"></i>
                </button>
              )}
              {activeSize && (
                <button
                  onClick={() => removeFilter('size')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gold-200 rounded-full text-sm font-medium text-gold-700 hover:bg-gold-100 transition-colors group"
                >
                  <i className="ri-ruler-line text-xs"></i>
                  Size: {activeSize}
                  <i className="ri-close-line text-gray-400 group-hover:text-gold-700 transition-colors"></i>
                </button>
              )}
              {activeSearch && (
                <button
                  onClick={() => removeFilter('search')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gold-200 rounded-full text-sm font-medium text-gold-700 hover:bg-gold-100 transition-colors group"
                >
                  Search: {activeSearch}
                  <i className="ri-close-line text-gray-400 group-hover:text-gold-700 transition-colors"></i>
                </button>
              )}
              {selectedRating > 0 && (
                <button
                  onClick={() => removeFilter('rating')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gold-200 rounded-full text-sm font-medium text-gold-700 hover:bg-gold-100 transition-colors group"
                >
                  <i className="ri-star-fill text-amber-400 text-xs"></i>
                  {selectedRating}+ stars
                  <i className="ri-close-line text-gray-400 group-hover:text-gold-700 transition-colors"></i>
                </button>
              )}
              {priceRange[1] < 5000 && (
                <button
                  onClick={() => { setPriceRange([0, 5000]); setPage(1); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gold-200 rounded-full text-sm font-medium text-gold-700 hover:bg-gold-100 transition-colors group"
                >
                  Max GH₵{priceRange[1]}
                  <i className="ri-close-line text-gray-400 group-hover:text-gold-700 transition-colors"></i>
                </button>
              )}
              {(sortBy === 'new' || sortBy === 'newest') && (
                <button
                  onClick={() => { setSortBy('popular'); setPage(1); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gold-200 rounded-full text-sm font-medium text-gold-700 hover:bg-gold-100 transition-colors group"
                >
                  New Arrivals
                  <i className="ri-close-line text-gray-400 group-hover:text-gold-700 transition-colors"></i>
                </button>
              )}
              <button
                onClick={clearAllFilters}
                className="text-sm text-gray-500 hover:text-red-600 underline underline-offset-2 transition-colors"
              >
                Clear all
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Filter Toggle */}
      <div className="lg:hidden bg-white border-b border-gray-200 py-4 px-4 sticky top-[72px] z-20">
        <div className="flex justify-between items-center">
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className="flex items-center space-x-2 text-gray-900 font-medium"
          >
            <i className="ri-filter-3-line text-xl"></i>
            <span>Filters & Sort</span>
          </button>
          <span className="text-sm text-gray-500">{totalProducts} Products</span>
        </div>
      </div>

      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex gap-8">
            {/* Mobile: one full-screen scrollport (z above bottom nav / WhatsApp).
                Nested max-h colour scroll was trapping touch so the drawer felt stuck. */}
            <aside
              className={`${
                isFilterOpen
                  ? 'fixed inset-0 z-[60] bg-white flex flex-col'
                  : 'hidden'
              } lg:flex lg:relative lg:inset-auto lg:z-auto lg:w-64 lg:flex-shrink-0 lg:flex-col`}
            >
              <div className="lg:sticky lg:top-24 flex flex-col min-h-0 flex-1 lg:flex-none lg:max-h-none">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0 lg:hidden">
                  <h2 className="text-xl font-bold text-gray-900">Filters</h2>
                  <button
                    type="button"
                    onClick={() => setIsFilterOpen(false)}
                    className="w-10 h-10 flex items-center justify-center text-gray-700"
                    aria-label="Close filters"
                  >
                    <i className="ri-close-line text-2xl"></i>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-6 lg:overflow-visible lg:p-0 space-y-8">
                    {/* Categories */}
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-4">Categories</h3>
                      <div className="space-y-1">
                        <button
                          onClick={() => {
                            setCategoryFilter('all');
                            setIsFilterOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${selectedCategory === 'all'
                            ? 'bg-gold-100 text-gold-700 font-medium'
                            : 'text-gray-700 hover:bg-gray-100'
                            }`}
                        >
                          All Products
                        </button>

                        {/* Parent Categories */}
                        {categories.filter(c => !c.parent_id && c.id !== 'all').map(parent => {
                          const subcategories = categories.filter(c => c.parent_id === parent.id);
                          const isSelected = selectedCategory === parent.slug;
                          const isChildSelected = subcategories.some(sub => sub.slug === selectedCategory);
                          const isOpen = isSelected || isChildSelected; // Auto-expand if selected

                          return (
                            <div key={parent.id} className="space-y-1">
                              <button
                                onClick={() => {
                                  setCategoryFilter(parent.slug);
                                  // Don't close filter immediately if exploring hierarchy
                                }}
                                className={`w-full text-left px-4 py-2 rounded-lg transition-colors flex justify-between items-center ${isSelected
                                  ? 'bg-gold-50 text-gold-700 font-medium'
                                  : 'text-gray-700 hover:bg-gray-100'
                                  }`}
                              >
                                <span>{parent.name}</span>
                              </button>

                              {/* Subcategories */}
                              {subcategories.length > 0 && (
                                <div className="ml-4 border-l-2 border-gray-100 pl-2 space-y-1">
                                  {subcategories.map(child => (
                                    <button
                                      key={child.id}
                                      onClick={() => {
                                        setCategoryFilter(child.slug);
                                        setIsFilterOpen(false);
                                      }}
                                      className={`w-full text-left px-4 py-1.5 rounded-lg text-sm transition-colors ${selectedCategory === child.slug
                                        ? 'text-gold-700 font-medium bg-gold-50'
                                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                                        }`}
                                    >
                                      {child.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Price Range */}
                    <div className="border-t border-gray-200 pt-8">
                      <h3 className="font-semibold text-gray-900 mb-4">Max Price: GH₵{priceRange[1]}</h3>
                      <div className="space-y-4">
                        <input
                          type="range"
                          min="0"
                          max="5000"
                          step="50"
                          value={priceRange[1]}
                          onChange={(e) => {
                            setPriceRange([0, parseInt(e.target.value)]);
                            setPage(1);
                          }}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gold-600"
                        />
                        <div className="flex items-center justify-between text-sm text-gray-600">
                          <span>GH₵0</span>
                          <span>GH₵5000+</span>
                        </div>
                      </div>
                    </div>

                    {/* Colour */}
                    {availableColors.length > 0 && (
                      <div className="border-t border-gray-200 pt-8">
                        <h3 className="font-semibold text-gray-900 mb-4">Colour</h3>
                        <div className="flex flex-wrap gap-2 lg:max-h-48 lg:overflow-y-auto lg:pr-1">
                          {availableColors.map((color) => {
                            const active = selectedColor.toLowerCase() === color.toLowerCase();
                            return (
                              <button
                                key={color}
                                type="button"
                                onClick={() => {
                                  const next = active ? '' : color;
                                  setSelectedColor(next);
                                  setPage(1);
                                  const params = new URLSearchParams(searchParams.toString());
                                  if (next) params.set('color', next);
                                  else params.delete('color');
                                  const qs = params.toString();
                                  router.replace(qs ? `/shop?${qs}` : '/shop', { scroll: false });
                                }}
                                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                                  active
                                    ? 'bg-gold-100 border-gold-300 text-gold-800 font-semibold'
                                    : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                                }`}
                              >
                                {color}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Rating */}
                    <div className="border-t border-gray-200 pt-8">
                      <h3 className="font-semibold text-gray-900 mb-2">Rating</h3>
                      {hasRatedProducts === false ? (
                        <p className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-3">
                          No customer reviews yet — rating filters will activate once products have approved reviews.
                        </p>
                      ) : (
                        <>
                          <p className="text-xs text-gray-500 mb-3">Based on approved customer reviews</p>
                          <div className="space-y-2">
                            {[4, 3, 2, 1].map((rating) => {
                              const active = selectedRating === rating;
                              return (
                                <button
                                  key={rating}
                                  type="button"
                                  onClick={() => setRatingFilter(rating)}
                                  aria-pressed={active}
                                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                                    active
                                      ? 'bg-gold-100 border-gold-300 text-gold-800 font-semibold'
                                      : 'border-transparent text-gray-700 hover:bg-gray-100'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center space-x-2">
                                      {[1, 2, 3, 4, 5].map((star) => (
                                        <i
                                          key={star}
                                          className={`pointer-events-none ${star <= rating ? 'ri-star-fill text-amber-400' : 'ri-star-line text-gray-300'} text-sm`}
                                        ></i>
                                      ))}
                                      <span className="text-sm pointer-events-none">& Up</span>
                                    </div>
                                    {active && (
                                      <i className="ri-check-line text-gold-700 pointer-events-none"></i>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>

                  </div>

                <div className="shrink-0 border-t border-gray-100 bg-white px-6 py-4 space-y-2 safe-area-bottom lg:border-0 lg:bg-transparent lg:px-0 lg:pt-8 lg:pb-0">
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="w-full border-2 border-gray-300 text-gray-800 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                    >
                      Clear All Filters
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsFilterOpen(false)}
                    className="w-full bg-gray-900 hover:bg-gold-600 text-white py-3 rounded-lg font-medium transition-colors whitespace-nowrap lg:mt-0"
                  >
                    Show Results
                  </button>
                </div>
              </div>
            </aside>

            <div className="flex-1">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
                <p className="text-gray-600" aria-live="polite">
                  {loading ? (
                    <span className="inline-flex items-center gap-2 text-gray-500">
                      <i className="ri-loader-4-line animate-spin" aria-hidden />
                      {activeSearch ? 'Searching…' : 'Loading products…'}
                    </span>
                  ) : (
                    <>
                      Showing{' '}
                      <span className="font-semibold text-gray-900">{products.length}</span>
                      {' '}of{' '}
                      <span className="font-semibold text-gray-900">{totalProducts}</span>
                      {' '}products
                    </>
                  )}
                </p>

                <div className="flex items-center space-x-3">
                  <label className="text-sm text-gray-600 whitespace-nowrap">Sort by:</label>
                  <select
                    value={sortBy === 'newest' ? 'new' : sortBy}
                    onChange={(e) => {
                      setSortBy(e.target.value);
                      setPage(1);
                      const params = new URLSearchParams(searchParams.toString());
                      if (e.target.value === 'popular') params.delete('sort');
                      else params.set('sort', e.target.value);
                      const qs = params.toString();
                      router.replace(qs ? `/shop?${qs}` : '/shop', { scroll: false });
                    }}
                    className="px-4 py-2 pr-8 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-500 focus:border-gold-500 text-sm bg-white cursor-pointer"
                  >
                    <option value="popular">Most Popular</option>
                    <option value="new">New Arrivals</option>
                    <option value="recent">Recently Added</option>
                    <option value="price-low">Price: Low to High</option>
                    <option value="price-high">Price: High to Low</option>
                    <option value="rating">Highest Rated</option>
                  </select>
                </div>
              </div>

              {loading ? (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6 lg:gap-8">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="bg-gray-100 rounded-xl aspect-[4/5] animate-pulse"></div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6 lg:gap-8" data-product-shop>
                    {products.map((product, idx) => (
                      <div key={product.id} className="animate-fade-in-up" style={{ animationDelay: `${(idx % productsPerPage) * 40}ms` }}>
                        <ProductCard {...product} priority={idx < 4} />
                      </div>
                    ))}
                  </div>

                  {products.length === 0 && (
                    <div className="text-center py-20">
                      <div className="w-20 h-20 flex items-center justify-center mx-auto mb-6 bg-gray-100 rounded-full">
                        <i className="ri-inbox-line text-4xl text-gray-400"></i>
                      </div>
                      <h3 className="text-2xl font-bold text-gray-900 mb-2">No Products Found</h3>
                      <p className="text-gray-600 mb-8">
                        {selectedRating > 0
                          ? hasRatedProducts === false
                            ? 'No products have customer reviews yet, so rating filters have nothing to match. Clear the rating filter or check back after reviews are approved.'
                            : `No products match ${selectedRating}+ stars with your other filters. Try a lower rating or clear filters.`
                          : (sortBy === 'new' || sortBy === 'newest')
                            ? 'No products are marked as New Arrivals yet. Mark items in the admin product editor to show them here.'
                            : sortBy === 'rating'
                              ? 'No rated products yet. Highest Rated only shows products with customer reviews.'
                              : 'Try adjusting your filters to find what you\'re looking for'}
                      </p>
                      <button
                        onClick={clearAllFilters}
                        className="inline-flex items-center bg-gray-900 hover:bg-gold-600 text-white px-6 py-3 rounded-lg font-medium transition-colors whitespace-nowrap"
                      >
                        Clear All Filters
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-16 flex justify-center">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="w-10 h-10 flex items-center justify-center border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <i className="ri-arrow-left-s-line text-xl text-gray-700"></i>
                    </button>

                    {/* Simple page numbers - condensed for brevity */}
                    <span className="px-4 font-medium text-gray-700">
                      Page {page} of {totalPages}
                    </span>

                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="w-10 h-10 flex items-center justify-center border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <i className="ri-arrow-right-s-line text-xl text-gray-700"></i>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function ShopPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-12 h-12 border-4 border-gold-600 border-t-transparent rounded-full animate-spin"></div></div>}>
      <ShopContent />
    </Suspense>
  );
}