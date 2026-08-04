'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import dynamic from 'next/dynamic';
import ProductCard from '@/components/ProductCard';
const ProductReviews = dynamic(() => import('@/components/ProductReviews'), { ssr: false });
import { StructuredData, generateProductSchema, generateBreadcrumbSchema } from '@/components/SEOHead';
import { notFound } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { useWishlist } from '@/context/WishlistContext';
import { sortSizes } from '@/lib/sort-sizes';
import { fetchStorePromotions, salePrice } from '@/lib/promotions';

function isLightColor(hex: string | null): boolean {
  if (!hex || typeof hex !== 'string') return false;
  const c = hex.replace('#', '').trim();
  if (c.length < 6) return false;
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return false;
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

function isProductVideoUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('data:video') || /\.(mp4|webm|ogg|mov)(\?|#|$)/i.test(url);
}

/** Cache-bust + #t=0.001 so browsers paint a first-frame preview (not a black box). */
function videoPreviewSrc(url: string): string {
  if (!url || url.startsWith('data:')) return url;
  try {
    const u = new URL(url, 'https://hystepper.com');
    u.searchParams.set('v', 'range-1');
    u.hash = '';
    return `${u.toString()}#t=0.001`;
  } catch {
    const base = url.split('#')[0];
    const joiner = base.includes('?') ? '&' : '?';
    return `${base}${joiner}v=range-1#t=0.001`;
  }
}

/** Keep storefront product videos silent even if the user unmutes native controls. */
function keepVideoSilent(video: HTMLVideoElement) {
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
}

export default function ProductDetailClient({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedSize, setSelectedSize] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [colorOverrideImage, setColorOverrideImage] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState('description');

  // Customers arriving from the delivered-order SMS/email link land with
  // ?review=write (or just #reviews). Switch to the Reviews tab on mount
  // so the ProductReviews component is actually rendered and can auto-open
  // the write-review form. Done in an effect (not initial state) so SSR /
  // hydration stay consistent.
  useEffect(() => {
    const wantsReview =
      searchParams?.get('review') === 'write' ||
      (typeof window !== 'undefined' && window.location.hash === '#reviews');
    if (wantsReview) setActiveTab('reviews');
  }, [searchParams]);
  const [relatedProducts, setRelatedProducts] = useState<any[]>([]);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notifySubmitted, setNotifySubmitted] = useState(false);
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [mainImageError, setMainImageError] = useState(false);

  // Track touch positions so we can swipe between gallery images on mobile
  // without pulling in a full carousel library.
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const SWIPE_THRESHOLD_PX = 40;

  const goToImage = (next: number) => {
    if (!product) return;
    const imgs: any[] = Array.isArray(product.images) ? product.images : [];
    if (imgs.length === 0) return;
    const normalized = ((next % imgs.length) + imgs.length) % imgs.length;
    setSelectedImage(normalized);
    setColorOverrideImage(null);
    setMainImageError(false);
  };

  const handleMediaTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartXRef.current = t.clientX;
    touchStartYRef.current = t.clientY;
  };

  const handleMediaTouchEnd = (e: React.TouchEvent) => {
    const startX = touchStartXRef.current;
    const startY = touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    if (startX === null || startY === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    // Only treat as a horizontal swipe; otherwise let the page scroll vertically.
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0) goToImage(selectedImage + 1);
    else goToImage(selectedImage - 1);
  };

  const { addToCart } = useCart();
  const { addToWishlist, removeFromWishlist, isInWishlist } = useWishlist();
  const isWishlisted = product ? isInWishlist(product.id) : false;

  const handleToggleWishlist = () => {
    if (!product) return;
    if (isInWishlist(product.id)) {
      removeFromWishlist(product.id);
      return;
    }
    const stockCount = Number(product.totalVariantStock ?? product.stockCount ?? product.quantity ?? 0);
    addToWishlist({
      id: product.id,
      name: product.name,
      price: Number(product.price) || 0,
      originalPrice:
        product.compare_at_price && Number(product.compare_at_price) > Number(product.price)
          ? Number(product.compare_at_price)
          : undefined,
      image: (Array.isArray(product.images) && product.images[0]) || '',
      rating: Number(product.rating) || 0,
      reviewCount: Number(product.reviewCount) || 0,
      inStock: stockCount > 0 || product.isPreorder === true,
      slug: product.slug || product.id,
    });
  };

  useEffect(() => {
    async function fetchProduct() {
      try {
        setLoading(true);
        let query = supabase
          .from('products')
          .select(`
            id, name, slug, description, price, compare_at_price, quantity, sku,
            category_id, rating_avg, product_code, material, heel_height, style_name,
            sizing_notes, metadata,
            categories(name, slug),
            product_variants(id, name, sku, option1, option2, option3, quantity, image_url),
            product_images(url, position)
          `)
          .not('product_images.url', 'ilike', 'data:video%');

        // Check if slug looks like a UUID
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);

        if (isUUID) {
          query = query.or(`id.eq.${slug},slug.eq.${slug}`);
        } else {
          query = query.eq('slug', slug);
        }

        const { data: productData, error } = await query.single();

        if (error || !productData) {
          console.error('Error fetching product:', error);
          setLoading(false);
          return;
        }

        const features = [];
        if (productData.style_name) features.push(`Style: ${productData.style_name}`);
        if (productData.material) features.push(`Material: ${productData.material}`);
        if (productData.heel_height) features.push(`Heel Height: ${productData.heel_height}`);
        if (productData.sizing_notes) features.push(`Sizing: ${productData.sizing_notes}`);
        if (features.length === 0) features.push('Premium Quality', 'Authentic Design');

        // Transform product data (safe sort and filter out large base64 data URLs — they crash the browser)
        const rawImages = (productData.product_images || [])
          .filter((img: any) => img && img.url && typeof img.url === 'string')
          .filter((img: any) => !img.url.startsWith('data:video') && img.url.length < 500_000)
          .sort((a: any, b: any) => (Number(a?.position) ?? 0) - (Number(b?.position) ?? 0))
          .map((img: any) => img.url);
        const categoryRow = Array.isArray(productData.categories)
          ? productData.categories[0]
          : productData.categories;
        const transformedProduct = {
          ...productData,
          images: Array.isArray(rawImages) ? rawImages : [],
          category: categoryRow?.name || 'Shop',
          categorySlug: categoryRow?.slug || '',
          rating: productData.rating_avg || 0,
          reviewCount: 0, // Placeholder
          stockCount: productData.quantity,
          colors: (() => {
            const seen = new Set<string>();
            return (productData.product_variants || [])
              .filter((v: any) => v && v.option2)
              .reduce((acc: any[], v: any) => {
                const name = (v.option2 ?? '').toString().trim();
                if (!name) return acc;
                const hex = (v.option3 && typeof v.option3 === 'string') ? v.option3 : null;
                const image = (v.image_url && typeof v.image_url === 'string') ? v.image_url : null;
                if (!seen.has(name)) {
                  seen.add(name);
                  acc.push({ name, hex, image });
                } else if (image) {
                  const existing = acc.find((c: any) => c.name === name);
                  if (existing) existing.image = image;
                }
                return acc;
              }, []);
          })(),
          sizes: (() => {
            // `option1` is the canonical size column. For Color-Only variants
            // option1 is empty and `name` is just the colour (e.g. "Black"),
            // so we MUST NOT parse `name` for a size in that case — otherwise
            // the colour shows up as the only "size" on the product page.
            const variants = productData.product_variants || [];
            const hasColors = variants.some((v: any) => v.option2);
            const sizeSet = new Set<string>();
            variants.forEach((v: any) => {
              let raw = (v.option1 ?? '').toString().trim();
              if (!raw && !hasColors) {
                // Legacy size-only rows that only stored the size in `name`.
                raw = (v.name ?? '').toString().trim();
              } else if (!raw && hasColors) {
                // Legacy size+colour rows that stored "Size / Colour" in name.
                const n = (v.name ?? '').toString();
                if (n.includes(' / ')) raw = n.split(' / ')[0].trim();
              }
              if (raw) sizeSet.add(raw);
            });
            return sortSizes([...sizeSet]);
          })(),
          variants: productData.product_variants || [],
          totalVariantStock: (productData.product_variants || []).reduce((sum: number, v: any) => sum + (Number(v?.quantity) || 0), 0),
          features: features,
          care: 'Handle with care. Keep in dry place.',
          isPreorder: productData.metadata?.is_preorder || false
        };

        // Ensure at least one image/placeholder
        if (transformedProduct.images.length === 0) {
          transformedProduct.images = ['/placeholder-product.png'];
        }

        // Apply live store-wide sale for display. Cart still stores the list
        // price (listPrice); checkout reapplies the current % so ending a sale
        // mid-cart doesn't leave stale discounted line items unpaid.
        try {
          const promo = await fetchStorePromotions();
          const list = Number(transformedProduct.price) || 0;
          (transformedProduct as any).listPrice = list;
          if (promo.storewideSaleEnabled && promo.storewideSalePercent > 0 && list > 0) {
            const discounted = salePrice(list, promo);
            const existingCompare = Number(transformedProduct.compare_at_price) || 0;
            transformedProduct.price = discounted;
            transformedProduct.compare_at_price = Math.max(existingCompare, list);
            (transformedProduct as any).storewide_sale_percent = promo.storewideSalePercent;
            (transformedProduct as any).storewide_sale_name = promo.storewideSaleName || 'Sale';
          }
        } catch {
          /* ignore — show list prices */
        }

        setProduct(transformedProduct);

        // Default select first size if available
        if (transformedProduct.sizes.length > 0) {
          // Do not auto-select size so validation triggers
          // setSelectedSize(transformedProduct.sizes[0]);
        }

        // Fetch related products (e.g., same category)
        if (productData.category_id) {
          const { data: related } = await supabase
            .from('products')
            .select('slug, name, price, quantity, rating_avg, product_variants(quantity), product_images(url, position)')
            .eq('category_id', productData.category_id)
            .eq('status', 'active')
            .neq('id', productData.id)
            .not('product_images.url', 'ilike', 'data:video%')
            .order('position', { foreignTable: 'product_images', ascending: true })
            .limit(4)
            .limit(1, { foreignTable: 'product_images' });

          if (related) {
            setRelatedProducts(related.map(p => ({
              id: p.slug,
              name: p.name,
              price: p.price,
              image: p.product_images?.[0]?.url || '/placeholder-product.png',
              rating: p.rating_avg || 0,
              reviewCount: 0,
              inStock: ((p.product_variants || []).length > 0
                ? (p.product_variants || []).reduce((sum: number, v: any) => sum + (Number(v?.quantity) || 0), 0)
                : (Number(p.quantity) || 0)) > 0
            })));
          }
        }

      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    if (slug) {
      fetchProduct();
    }
  }, [slug]);

  const [showSizeError, setShowSizeError] = useState(false);
  const [showColorError, setShowColorError] = useState(false);
  const colorSectionRef = useRef<HTMLDivElement | null>(null);
  const sizeSectionRef = useRef<HTMLDivElement | null>(null);

  // Normalise variant identifiers — option1/option2 in the DB can have stray
  // whitespace (e.g. "Black " with a trailing space) which would otherwise
  // break exact equality matches against the trimmed selectedColor/selectedSize.
  const norm = (s: unknown) => String(s ?? '').trim();
  // Helper: pull a variant's size out of option1 if present, else the prefix
  // of "Size / Colour" in the name field, else the whole name (legacy).
  const variantSize = (v: any): string => {
    const fromOption = norm(v?.option1);
    if (fromOption) return fromOption;
    const name = norm(v?.name);
    if (name.includes(' / ')) return name.split(' / ')[0].trim();
    return name;
  };

  // Helper: true when the product needs variant selection but the user
  // hasn't picked everything yet (e.g. picked size but not colour).
  const isVariantSelectionIncomplete = () => {
    if (!product) return false;
    const hasColors = product.colors && product.colors.length > 0;
    const hasSizes = product.sizes && product.sizes.length > 0;
    if (hasColors && !selectedColor) return true;
    if (hasSizes && !selectedSize) return true;
    return false;
  };

  // Helper: get effective stock — variant stock when product has variants, else product stock.
  // Returns 0 when variant selection is incomplete so the quantity controls can't
  // be cranked above any single variant's true stock (e.g. user picks size 38 but
  // hasn't picked a colour — without this guard we'd fall back to the sum of all
  // variant quantities and let them buy more than exists for any one combo).
  const getEffectiveStock = () => {
    if (!product) return 0;
    const hasColors = product.colors && product.colors.length > 0;
    const hasSizes = product.sizes && product.sizes.length > 0;

    if (isVariantSelectionIncomplete()) return 0;

    if (hasColors && hasSizes && selectedColor && selectedSize) {
      const match = product.variants?.find((v: any) =>
        variantSize(v) === norm(selectedSize) && norm(v.option2) === norm(selectedColor)
      );
      return match ? (match.quantity ?? 0) : 0;
    }
    if (hasColors && !hasSizes && selectedColor) {
      const match = product.variants?.find((v: any) =>
        norm(v.option2) === norm(selectedColor) || norm(v.name) === norm(selectedColor)
      );
      return match ? (match.quantity ?? 0) : 0;
    }
    if (!hasColors && hasSizes && selectedSize) {
      const match = product.variants?.find((v: any) => variantSize(v) === norm(selectedSize));
      return match ? (match.quantity ?? 0) : 0;
    }
    const variantTotal = Number(product.totalVariantStock) || 0;
    const hasVariantInventory = Array.isArray(product.variants) && product.variants.length > 0;
    return hasVariantInventory ? variantTotal : (Number(product.stockCount) || 0);
  };

  // Clamp quantity when variant selection changes (stock may be lower)
  useEffect(() => {
    if (!product) return;
    const effective = getEffectiveStock();
    if (effective > 0) {
      setQuantity((q) => Math.max(1, Math.min(q, effective)));
    } else {
      setQuantity(1);
    }
  }, [product, selectedColor, selectedSize]);

  const focusFirstVariantError = (missingColor: boolean, missingSize: boolean) => {
    const target = missingColor ? colorSectionRef.current : missingSize ? sizeSectionRef.current : null;
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      window.scrollBy({ top: -100, behavior: 'smooth' });
    }
  };

  const handleAddToCart = () => {
    if (!product) return;

    const missingColor = !!(product.colors && product.colors.length > 0 && !selectedColor);
    const missingSize = !!(product.sizes && product.sizes.length > 0 && !selectedSize);

    if (missingColor) setShowColorError(true);
    if (missingSize) setShowSizeError(true);

    if (missingColor || missingSize) {
      focusFirstVariantError(missingColor, missingSize);
      return;
    }

    const price = Number(product.listPrice ?? product.price);
    const maxStock = getEffectiveStock();

    const firstImage = (product.images || []).find(
      (img: string) => typeof img === 'string' && !img.startsWith('data:video')
    );
    const image = firstImage ?? '/placeholder-product.png';

    if (Number.isNaN(price) || price < 0) return;

    // Pick the most specific variant SKU we can — match on size + colour first,
    // then fall back to size-only, then any matching variant. Falls through to
    // the parent product's SKU if no variant matches (or product has none).
    const matchedVariant = (() => {
      const variants: any[] = product.variants || [];
      if (!variants.length) return null;
      const size = norm(selectedSize);
      const colour = norm(selectedColor);
      // Match on size + colour first (using the size helper so option1=null rows still work),
      // then size only, then colour only.
      const byBoth = size && colour
        ? variants.find((v: any) => variantSize(v) === size && norm(v.option2) === colour)
        : null;
      if (byBoth) return byBoth;
      const bySize = size
        ? variants.find((v: any) => variantSize(v) === size)
        : null;
      if (bySize) return bySize;
      const byColour = colour
        ? variants.find((v: any) => norm(v.option2) === colour)
        : null;
      return byColour;
    })();
    const resolvedSku = (matchedVariant?.sku || product.sku || '').toString().trim() || undefined;

    addToCart({
      id: product.id,
      name: product.name ?? 'Product',
      price,
      image,
      quantity: Math.max(1, Math.min(quantity, maxStock)),
      variant: [selectedSize, selectedColor].filter(Boolean).join(' / ') || undefined,
      slug: product.slug ?? product.id,
      maxStock,
      sku: resolvedSku,
      variantId: matchedVariant?.id,
      size: selectedSize || undefined,
      color: selectedColor || undefined,
    });
  };

  const handleBuyNow = () => {
    if (!product) return;

    const missingColor = !!(product.colors && product.colors.length > 0 && !selectedColor);
    const missingSize = !!(product.sizes && product.sizes.length > 0 && !selectedSize);

    if (missingColor) setShowColorError(true);
    if (missingSize) setShowSizeError(true);

    if (missingColor || missingSize) {
      focusFirstVariantError(missingColor, missingSize);
      return;
    }

    handleAddToCart();
    window.location.href = '/checkout';
  };

  const handleNotifyMe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifyEmail.trim()) return;
    setNotifyLoading(true);
    try {
      const { error } = await supabase
        .from('stock_notifications')
        .insert({
          product_id: product.id,
          email: notifyEmail.trim().toLowerCase(),
          notified: false,
        });
      if (error) throw error;
      setNotifySubmitted(true);
    } catch (err: any) {
      console.error('Notify me error:', err);
      // Might be a duplicate - that's ok
      setNotifySubmitted(true);
    } finally {
      setNotifyLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white py-12 flex justify-center items-center">
        <div className="text-center">
          <i className="ri-loader-4-line text-4xl text-gold-600 animate-spin mb-4 block"></i>
          <p className="text-gray-500">Loading product...</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-white py-20 flex justify-center items-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Product Not Found</h2>
          <Link href="/shop" className="text-gold-600 hover:underline">Return to Shop</Link>
        </div>
      </div>
    );
  }

  const discount = product.compare_at_price ? Math.round((1 - product.price / product.compare_at_price) * 100) : 0;

  // Stock for whatever the user currently has selected. Will be 0 when the
  // user hasn't picked all required variant options yet (see getEffectiveStock).
  const currentSelectionStock = getEffectiveStock();

  // True if the product has *anything* purchasable, anywhere across its
  // variants. Drives the "back in stock" form so we don't surface it just
  // because the user hasn't picked a size or colour yet.
  const productHasAnyStock = (() => {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length > 0) {
      return variants.some((v: any) => (Number(v?.quantity) || 0) > 0);
    }
    return (Number(product.stockCount) || 0) > 0;
  })();

  // "Out of stock" only when we can be certain: either the product has no
  // variants and its own quantity is 0, or the user has finished picking a
  // variant combo and that specific combo has 0 stock.
  const incompleteVariantSelection = isVariantSelectionIncomplete();
  const isSelectedOutOfStock = !incompleteVariantSelection && currentSelectionStock === 0;

  const productSchema = generateProductSchema({
    name: product.name,
    description: product.description,
    image: product.images[0],
    price: product.price,
    currency: 'GHS',
    sku: product.sku,
    rating: product.rating,
    reviewCount: product.reviewCount,
    availability: productHasAnyStock ? 'in_stock' : 'out_of_stock',
    category: product.category
  });

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://hystepper.com';
  const categoryHref = product.categorySlug
    ? `/shop?category=${encodeURIComponent(product.categorySlug)}`
    : `/categories/${encodeURIComponent(String(product.category || 'shop').toLowerCase())}`;
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: 'Home', url: siteUrl },
    { name: 'Shop', url: `${siteUrl}/shop` },
    { name: product.category, url: `${siteUrl}${categoryHref}` },
    { name: product.name, url: `${siteUrl}/product/${slug}` },
  ]);

  return (
    <>
      <StructuredData data={productSchema} />
      <StructuredData data={breadcrumbSchema} />

      <main className="min-h-screen bg-white">
        <section className="py-6 bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <nav className="flex items-center space-x-2 text-sm flex-wrap gap-y-2 font-medium">
              <Link href="/" className="text-gray-500 hover:text-gold-600 transition-colors flex items-center gap-1">
                <i className="ri-home-4-line"></i> Home
              </Link>
              <i className="ri-arrow-right-s-line text-gray-300"></i>
              <Link href="/shop" className="text-gray-500 hover:text-gold-600 transition-colors">Shop</Link>
              <i className="ri-arrow-right-s-line text-gray-300"></i>
              <Link href={categoryHref} className="text-gray-500 hover:text-gold-600 transition-colors">{product.category}</Link>
              <i className="ri-arrow-right-s-line text-gray-300"></i>
              <span className="text-gray-900 truncate max-w-[200px]">{product.name}</span>
            </nav>
          </div>
        </section>

        <section className="py-12 lg:py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="grid lg:grid-cols-12 gap-12 lg:gap-16">
              {/* Left Column: Images */}
              <div className="lg:col-span-7 animate-fade-in-up">
                <div className="sticky top-24">
                  {(() => {
                    const images = Array.isArray(product.images) ? product.images : [];
                    const fallback = images[0] || '/placeholder-product.png';
                    const currentMedia = (colorOverrideImage && typeof colorOverrideImage === 'string' && colorOverrideImage.trim())
                      ? colorOverrideImage.trim()
                      : (images[selectedImage] ?? fallback);
                    const safeSrc = typeof currentMedia === 'string' && currentMedia.trim() ? currentMedia.trim() : fallback;
                    const isVideo = isProductVideoUrl(safeSrc);
                    const videoSrc = isVideo ? videoPreviewSrc(safeSrc) : safeSrc;

                    return (
                  <div
                    className="group relative aspect-[4/5] rounded-3xl overflow-hidden bg-gray-50 mb-4 shadow-sm border border-gray-100 select-none touch-pan-y"
                    // Don't steal touch events from native video controls on iOS.
                    onTouchStart={isVideo ? undefined : handleMediaTouchStart}
                    onTouchEnd={isVideo ? undefined : handleMediaTouchEnd}
                  >
                    {/* Main Media Display — color override takes priority */}
                    {(() => {
                      if (isVideo) {
                        // iOS Safari needs playsInline + Range-capable URLs (storage route).
                        // Prefer the first non-video image as poster so the player isn't black.
                        const poster =
                          images.find(
                            (img: string) =>
                              typeof img === 'string' && !isProductVideoUrl(img)
                          ) || undefined;
                        return (
                          <video
                            key={videoSrc}
                            src={videoSrc}
                            className="w-full h-full object-cover bg-gray-100"
                            controls
                            muted
                            playsInline
                            preload="metadata"
                            controlsList="nodownload noplaybackrate"
                            disablePictureInPicture
                            poster={poster}
                            onLoadedMetadata={(e) => {
                              const v = e.currentTarget;
                              keepVideoSilent(v);
                              // Force a painted frame when #t= fragment is ignored.
                              if (v.currentTime < 0.05) {
                                try { v.currentTime = 0.05; } catch { /* ignore */ }
                              }
                            }}
                            onPlay={(e) => keepVideoSilent(e.currentTarget)}
                            onVolumeChange={(e) => keepVideoSilent(e.currentTarget)}
                          >
                            <source src={videoSrc} type="video/mp4" />
                          </video>
                        );
                      }

                      if (mainImageError || safeSrc.startsWith('data:')) {
                        return (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={safeSrc}
                            alt={product.name || 'Product'}
                            className="w-full h-full object-cover object-center"
                          />
                        );
                      }

                      return (
                        <Image
                          key={safeSrc}
                          src={safeSrc}
                          alt={product.name || 'Product'}
                          fill
                          sizes="(max-width: 1024px) 100vw, 60vw"
                          className="object-cover object-center transition-opacity duration-500"
                          unoptimized={!!colorOverrideImage}
                          onError={() => setMainImageError(true)}
                          priority
                        />
                      );
                    })()}

                    {discount > 0 && (
                      <span className="absolute top-6 right-6 bg-red-600 text-white text-sm font-bold px-4 py-1.5 rounded-full z-10 shadow-lg">
                        -{discount}% OFF
                      </span>
                    )}

                    {Array.isArray(product.images) && product.images.length > 1 && !colorOverrideImage && !isVideo && (
                      <>
                        <button
                          type="button"
                          onClick={() => goToImage(selectedImage - 1)}
                          aria-label="Previous image"
                          className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 items-center justify-center rounded-full bg-white/80 hover:bg-white backdrop-blur text-gray-900 shadow-md border border-gray-200 transition-opacity opacity-0 group-hover:opacity-100"
                        >
                          <i className="ri-arrow-left-s-line text-xl"></i>
                        </button>
                        <button
                          type="button"
                          onClick={() => goToImage(selectedImage + 1)}
                          aria-label="Next image"
                          className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 items-center justify-center rounded-full bg-white/80 hover:bg-white backdrop-blur text-gray-900 shadow-md border border-gray-200 transition-opacity opacity-0 group-hover:opacity-100"
                        >
                          <i className="ri-arrow-right-s-line text-xl"></i>
                        </button>

                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm">
                          {product.images.map((_: any, i: number) => (
                            <span
                              key={i}
                              className={`h-1.5 rounded-full transition-all ${i === selectedImage ? 'bg-white w-4' : 'bg-white/60 w-1.5'}`}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                    );
                  })()}

                  {Array.isArray(product.images) && product.images.length > 1 && (
                    <div className="grid grid-cols-5 gap-3">
                      {product.images.filter((img: any) => img).map((image: string, index: number) => {
                        const isVideo = isProductVideoUrl(image);
                        const thumbSrc = isVideo ? videoPreviewSrc(image) : image;
                        const thumbPoster =
                          (Array.isArray(product.images) ? product.images : []).find(
                            (img: string) => typeof img === 'string' && !isProductVideoUrl(img)
                          ) || undefined;
                        const isSelected = !colorOverrideImage && selectedImage === index;
                        return (
                          <button
                            key={index}
                            onClick={() => { setSelectedImage(index); setColorOverrideImage(null); setMainImageError(false); }}
                            className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${isSelected ? 'border-gold-600 shadow-md ring-2 ring-gold-600/20 scale-95' : 'border-transparent hover:border-gray-300'
                              }`}
                          >
                            {isVideo ? (
                              <div className="w-full h-full bg-gray-200 flex items-center justify-center relative">
                                <video
                                  src={thumbSrc}
                                  className="w-full h-full object-cover"
                                  muted
                                  playsInline
                                  preload="metadata"
                                  poster={thumbPoster}
                                  onLoadedMetadata={(e) => {
                                    const v = e.currentTarget;
                                    keepVideoSilent(v);
                                    if (v.currentTime < 0.05) {
                                      try { v.currentTime = 0.05; } catch { /* ignore */ }
                                    }
                                  }}
                                />
                                <i className="ri-play-circle-fill text-white text-2xl absolute z-10 drop-shadow-md"></i>
                              </div>
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={typeof image === 'string' && image ? image : '/placeholder-product.png'}
                                alt={`${product.name || 'Product'} view ${index + 1}`}
                                className="w-full h-full object-cover object-center"
                                loading="lazy"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Product Details */}
              <div className="lg:col-span-5 animate-fade-in-up delay-100">
                <div className="sticky top-24">
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-sm text-gold-600 font-bold tracking-wider uppercase tracking-widest">{product.category}</p>
                    <button
                      onClick={handleToggleWishlist}
                      className="w-10 h-10 flex items-center justify-center bg-gray-50 hover:bg-red-50 rounded-full transition-colors cursor-pointer group"
                      aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                      title={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                    >
                      <i className={`${isWishlisted ? 'ri-heart-fill text-red-600' : 'ri-heart-line text-gray-400 group-hover:text-red-500'} text-xl transition-colors`}></i>
                    </button>
                  </div>
                  
                  <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4 leading-tight">{product.name}</h1>

                  <div className="flex items-center mb-6">
                    <div className="flex items-center space-x-1 mr-3">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <i
                          key={star}
                          className={`${star <= Math.round(Number(product.rating) || 0) ? 'ri-star-fill text-amber-400' : 'ri-star-line text-gray-200'} text-lg`}
                        ></i>
                      ))}
                    </div>
                    <span className="text-gray-600 font-medium text-sm">{(Number(product.rating) || 0).toFixed(1)}</span>
                    <span className="mx-3 text-gray-300">|</span>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('reviews');
                        // Wait a tick so the reviews tab is rendered before scrolling.
                        requestAnimationFrame(() => {
                          document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        });
                      }}
                      className="text-sm text-gray-500 hover:text-gold-600 transition-colors underline underline-offset-4 cursor-pointer"
                    >
                      Read Reviews
                    </button>
                  </div>

                  <div className="flex items-baseline space-x-4 mb-6 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                    <span className="text-4xl font-bold text-gray-900 tracking-tight">GH₵{(Number(product.price) || 0).toFixed(2)}</span>
                    {product.compare_at_price != null && Number(product.compare_at_price) > Number(product.price) && (
                      <span className="text-xl text-gray-400 line-through decoration-gray-300 decoration-2">GH₵{(Number(product.compare_at_price) || 0).toFixed(2)}</span>
                    )}
                    {product.storewide_sale_percent > 0 && (
                      <span className="text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        {product.storewide_sale_name || 'Sale'} −{product.storewide_sale_percent}%
                      </span>
                    )}
                  </div>

                  <p className="text-gray-600 leading-relaxed mb-8 text-base">{product.description}</p>

                {/* Variant Selection — color swatches or image thumbnails */}
                {product.colors && product.colors.length > 0 && (
                  <div
                    ref={colorSectionRef}
                    className={`mb-8 -mx-2 px-2 py-2 rounded-xl transition-colors scroll-mt-24 ${showColorError ? 'ring-2 ring-red-400 bg-red-50/40' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <label className={`font-semibold ${showColorError ? 'text-red-600' : 'text-gray-900'}`}>
                        Colors {showColorError && <span className="ml-1 text-xs font-normal">— please pick one</span>}
                      </label>
                      {selectedColor && <span className="text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">{selectedColor}</span>}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {product.colors.map((color: any) => {
                        const colorName = color?.name ?? '';
                        const colorImage = typeof color?.image === 'string' && color.image ? color.image : null;
                        const colorHex = color?.hex ?? null;
                        const isSelected = selectedColor === colorName;

                        if (colorImage) {
                          return (
                            <button
                              key={colorName}
                              onClick={() => {
                                setSelectedColor(colorName);
                                setSelectedSize('');
                                setShowColorError(false);
                                setColorOverrideImage(colorImage);
                                setMainImageError(false);
                              }}
                              className={`relative w-16 h-16 rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${isSelected
                                ? 'border-gold-600 ring-2 ring-gold-600/20 scale-105 shadow-md'
                                : 'border-gray-200 hover:border-gray-400 hover:scale-105'}`}
                              title={colorName}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={colorImage} alt={colorName} className="w-full h-full object-cover" />
                              {isSelected && (
                                <span className="absolute inset-0 bg-black/20 flex items-center justify-center backdrop-blur-[1px]">
                                  <i className="ri-check-line text-white text-xl font-bold drop-shadow-md"></i>
                                </span>
                              )}
                            </button>
                          );
                        }

                        return (
                          <button
                            key={colorName || colorHex}
                            onClick={() => {
                              setSelectedColor(colorName);
                              setSelectedSize('');
                              setShowColorError(false);
                              setColorOverrideImage(null);
                              setMainImageError(false);
                            }}
                            className={`group relative w-12 h-12 rounded-full border-2 transition-all cursor-pointer ${isSelected
                              ? 'border-gold-600 ring-4 ring-gold-600/20 scale-110 shadow-md'
                              : 'border-gray-200 hover:border-gray-400 hover:scale-105'}`}
                            title={colorName}
                          >
                            <span className="block w-full h-full rounded-full border border-black/5" style={{ backgroundColor: colorHex || '#ccc' }}></span>
                            {isSelected && (
                              <span className="absolute inset-0 flex items-center justify-center">
                                <i className={`ri-check-line text-lg font-bold ${isLightColor(colorHex) ? 'text-gray-800' : 'text-white'}`}></i>
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {showColorError && (
                      <p className="mt-2 flex items-center gap-1.5 text-sm text-red-600">
                        <i className="ri-error-warning-line"></i>
                        Please pick a color before continuing.
                      </p>
                    )}
                  </div>
                )}

                {/* Size Selection — filtered by selected color when colors exist */}
                {product.sizes && product.sizes.length > 0 && (
                  <div
                    ref={sizeSectionRef}
                    className={`mb-8 -mx-2 px-2 py-2 rounded-xl transition-colors scroll-mt-24 ${showSizeError ? 'ring-2 ring-red-400 bg-red-50/40' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <label className={`font-semibold ${showSizeError ? 'text-red-600' : 'text-gray-900'}`}>
                        Size {showSizeError && <span className="ml-1 text-xs font-normal">— please pick one</span>}
                      </label>
                      {selectedSize && <span className="text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">{selectedSize}</span>}
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
                      {product.sizes.map((size: string) => {
                        const hasColors = product.colors && product.colors.length > 0;
                        const isAvailable = !hasColors || !selectedColor
                          ? true
                          : product.variants.some((v: any) =>
                              variantSize(v) === norm(size)
                              && norm(v.option2) === norm(selectedColor)
                              && (v.quantity ?? 0) > 0
                            );
                        const isOutOfStock = hasColors && selectedColor && !isAvailable;

                        return (
                          <button
                            key={size}
                            onClick={() => {
                              if (isOutOfStock) return;
                              setSelectedSize(size);
                              setShowSizeError(false);
                            }}
                            disabled={isOutOfStock}
                            className={`py-3 rounded-xl border-2 font-semibold transition-all text-center ${isOutOfStock
                              ? 'border-gray-100 text-gray-300 cursor-not-allowed line-through bg-gray-50'
                              : selectedSize === size
                                ? 'border-gold-600 bg-gold-600 text-white shadow-md shadow-gold-600/20 scale-[1.02] cursor-pointer'
                                : 'border-gray-200 text-gray-700 hover:border-gray-400 hover:bg-gray-50 cursor-pointer'
                              }`}
                          >
                            {size}
                          </button>
                        );
                      })}
                    </div>
                    {showSizeError && (
                      <p className="mt-2 flex items-center gap-1.5 text-sm text-red-600">
                        <i className="ri-error-warning-line"></i>
                        Please pick a size before continuing.
                      </p>
                    )}
                  </div>
                )}

                {/* Quantity & Stock. Once selection is complete we render the
                    real stock badge (In Stock / Only N Left / Sold Out). Before
                    that, we surface a small hint telling the customer which
                    option they still need to pick. */}
                {(() => {
                  const displayStock = currentSelectionStock;
                  const controlsDisabled = incompleteVariantSelection || displayStock === 0;
                  const hasColors = product.colors && product.colors.length > 0;
                  const hasSizes = product.sizes && product.sizes.length > 0;
                  const missingParts: string[] = [];
                  if (hasSizes && !selectedSize) missingParts.push('size');
                  if (hasColors && !selectedColor) missingParts.push('colour');
                  // When both size and colour are missing we lead the customer
                  // with the colour prompt first — picking colour switches the
                  // size pills and reveals which sizes are stocked, so it's
                  // the more useful starting nudge. After they pick colour the
                  // hint updates to "Pick a size" if size is still missing.
                  const missingLabel =
                    missingParts.length === 2
                      ? 'a colour'
                      : missingParts.length === 1
                      ? `a ${missingParts[0]}`
                      : '';

                  return (
                    <div className="mb-8">
                      <label className="block font-semibold text-gray-900 mb-3">Quantity</label>
                      <div className="flex items-center space-x-4">
                        <div className={`flex items-center border-2 rounded-xl bg-white overflow-hidden shadow-sm border-gray-200 ${controlsDisabled ? 'opacity-60' : ''}`}>
                          <button
                            onClick={() => setQuantity(Math.max(1, quantity - 1))}
                            className="w-12 h-12 flex items-center justify-center text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-600"
                            disabled={controlsDisabled}
                            aria-label="Decrease quantity"
                          >
                            <i className="ri-subtract-line text-xl"></i>
                          </button>
                          <input
                            type="number"
                            value={quantity}
                            onChange={(e) => {
                              if (controlsDisabled) return;
                              const parsed = parseInt(e.target.value) || 1;
                              setQuantity(Math.max(1, Math.min(displayStock, parsed)));
                            }}
                            className="w-16 h-12 text-center border-x-2 border-gray-100 focus:outline-none text-lg font-bold text-gray-900 bg-gray-50/50 disabled:cursor-not-allowed"
                            min="1"
                            max={displayStock || 1}
                            disabled={controlsDisabled}
                          />
                          <button
                            onClick={() => setQuantity(Math.min(displayStock, quantity + 1))}
                            className="w-12 h-12 flex items-center justify-center text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-600"
                            disabled={controlsDisabled || quantity >= displayStock}
                            aria-label="Increase quantity"
                          >
                            <i className="ri-add-line text-xl"></i>
                          </button>
                        </div>
                        {incompleteVariantSelection && missingLabel && (
                          <span className="text-gray-700 font-medium flex items-center gap-1.5 bg-gray-100 px-3 py-1.5 rounded-full text-sm">
                            <i className="ri-information-line text-lg text-gray-500"></i>
                            Pick {missingLabel} to see availability
                          </span>
                        )}
                        {!incompleteVariantSelection && displayStock > 10 && (
                          <span className="text-emerald-600 font-semibold flex items-center gap-1.5 bg-emerald-50 px-3 py-1.5 rounded-full text-sm">
                            <i className="ri-checkbox-circle-fill text-lg"></i> In Stock
                          </span>
                        )}
                        {!incompleteVariantSelection && displayStock > 0 && displayStock <= 10 && (
                          <span className="text-amber-600 font-semibold flex items-center gap-1.5 bg-amber-50 px-3 py-1.5 rounded-full text-sm">
                            <i className="ri-error-warning-fill text-lg"></i> Only {displayStock} Left
                          </span>
                        )}
                        {!incompleteVariantSelection && displayStock === 0 && (
                          <span className="text-red-600 font-semibold flex items-center gap-1.5 bg-red-50 px-3 py-1.5 rounded-full text-sm">
                            <i className="ri-close-circle-fill text-lg"></i> Sold Out
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Add to Cart / Buy Now.
                    States:
                      - Truly out of stock (selection complete + 0, or no-variant
                        product with 0 stock): single disabled "Out of Stock"
                        button; the notify-me form appears below.
                      - Incomplete variant selection: both buttons render but are
                        styled as muted. We DON'T disable them so the click still
                        runs handleAddToCart/handleBuyNow, which already focus
                        and highlight the missing variant section.
                      - Normal: full-strength Add to Cart + Buy It Now. */}
                <div className="flex flex-col gap-3 mb-8">
                  {isSelectedOutOfStock ? (
                    <button
                      disabled
                      className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold flex items-center justify-center space-x-2 text-lg shadow-lg shadow-gray-900/20 opacity-50 cursor-not-allowed"
                    >
                      <i className="ri-shopping-cart-line text-xl"></i>
                      <span>Out of Stock</span>
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleAddToCart}
                        aria-disabled={incompleteVariantSelection}
                        className={`w-full bg-gray-900 hover:bg-gray-800 text-white py-4 rounded-xl font-bold transition-all flex items-center justify-center space-x-2 text-lg cursor-pointer shadow-lg shadow-gray-900/20 ${incompleteVariantSelection ? 'opacity-60' : 'hover:-translate-y-0.5'}`}
                      >
                        <i className="ri-shopping-cart-line text-xl"></i>
                        <span>Add to Cart</span>
                      </button>
                      <button
                        onClick={handleBuyNow}
                        aria-disabled={incompleteVariantSelection}
                        className={`w-full bg-gold-600 hover:bg-gold-700 text-white py-4 rounded-xl font-bold transition-all flex items-center justify-center space-x-2 text-lg cursor-pointer shadow-lg shadow-gold-600/20 ${incompleteVariantSelection ? 'opacity-60' : 'hover:-translate-y-0.5'}`}
                      >
                        <i className="ri-flashlight-fill text-xl"></i>
                        <span>Buy It Now</span>
                      </button>
                    </>
                  )}

                  <button
                    onClick={handleToggleWishlist}
                    className={`w-full py-4 rounded-xl font-bold transition-all flex items-center justify-center space-x-2 text-lg cursor-pointer border-2 ${isWishlisted
                      ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-red-200 hover:text-red-500'
                      }`}
                  >
                    <i className={`${isWishlisted ? 'ri-heart-fill' : 'ri-heart-line'} text-xl`}></i>
                    <span>{isWishlisted ? 'Saved to Wishlist' : 'Add to Wishlist'}</span>
                  </button>
                </div>

                {/* Notify Me When Back in Stock — only when the selected variant
                    is genuinely out of stock (or the product has no variants and
                    is sold out). We don't show this during incomplete variant
                    selection, because that's not actually "out of stock". */}
                {isSelectedOutOfStock && (
                  <div className="mb-8 p-6 bg-gray-50 border border-gray-200 rounded-2xl">
                    {notifySubmitted ? (
                      <div className="flex items-center gap-3 text-gold-700">
                        <i className="ri-checkbox-circle-fill text-2xl"></i>
                        <div>
                          <p className="font-bold text-lg">You&apos;re on the list!</p>
                          <p className="text-sm text-gray-600">We&apos;ll email you when this item is back in stock.</p>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="font-bold text-gray-900 mb-2 flex items-center gap-2 text-lg">
                          <i className="ri-notification-3-line text-gold-600"></i>
                          Get notified when back in stock
                        </p>
                        <p className="text-sm text-gray-600 mb-4">Leave your email and we'll let you know when this item is back in stock.</p>
                        <form onSubmit={handleNotifyMe} className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="email"
                            value={notifyEmail}
                            onChange={(e) => setNotifyEmail(e.target.value)}
                            placeholder="Enter your email"
                            className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-gold-500 focus:border-gold-500 outline-none"
                            required
                          />
                          <button
                            type="submit"
                            disabled={notifyLoading}
                            className="px-8 py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-bold transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                          >
                            {notifyLoading ? 'Saving...' : 'Notify Me'}
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 pt-8 border-t border-gray-100">
                  <div className="flex flex-col items-center justify-center text-center p-4 bg-gray-50 rounded-2xl border border-gray-100 transition-colors hover:bg-gray-100">
                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3 text-gold-600">
                      <i className="ri-truck-line text-2xl"></i>
                    </div>
                    <h4 className="font-bold text-gray-900 text-sm mb-1">Reliable Delivery</h4>
                    <p className="text-xs text-gray-500">Nationwide shipping</p>
                  </div>
                  <div className="flex flex-col items-center justify-center text-center p-4 bg-gray-50 rounded-2xl border border-gray-100 transition-colors hover:bg-gray-100">
                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3 text-gold-600">
                      <i className="ri-shield-check-line text-2xl"></i>
                    </div>
                    <h4 className="font-bold text-gray-900 text-sm mb-1">Secure Payment</h4>
                    <p className="text-xs text-gray-500">100% safe checkout</p>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between text-sm text-gray-500 bg-gray-50 px-4 py-3 rounded-xl border border-gray-100">
                  <span className="flex items-center gap-2">
                    <i className="ri-barcode-box-line text-lg"></i>
                    SKU:
                  </span>
                  <span className="font-mono font-medium text-gray-900">{product.product_code || product.sku || product.id.substring(0, 8).toUpperCase()}</span>
                </div>
              </div>
            </div>
          </div>
          </div>
        </section>

        <section id="reviews" className="py-16 bg-white border-t border-gray-100 scroll-mt-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <div className="flex justify-center mb-10">
              <div className="inline-flex bg-gray-100 p-1.5 rounded-2xl">
                {['description', 'features', 'reviews'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-8 py-3 rounded-xl font-bold transition-all whitespace-nowrap cursor-pointer text-sm sm:text-base ${activeTab === tab
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                      }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-gray-50 rounded-3xl p-8 sm:p-12 border border-gray-100 min-h-[300px]">
              {activeTab === 'description' && (
                <div className="prose max-w-none animate-fade-in-up">
                  <h3 className="text-2xl font-bold text-gray-900 mb-6">About this item</h3>
                  <p className="text-gray-600 text-lg leading-relaxed whitespace-pre-line">{product.description}</p>
                </div>
              )}

              {activeTab === 'features' && (
                <div className="animate-fade-in-up">
                  <h3 className="text-2xl font-bold text-gray-900 mb-8">Key Features</h3>
                  <ul className="grid sm:grid-cols-2 gap-6">
                    {product.features?.length > 0 ? product.features.map((feature: string, index: number) => (
                      <li key={index} className="flex items-start bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                        <div className="w-10 h-10 bg-gold-50 rounded-full flex items-center justify-center mr-4 shrink-0">
                          <i className="ri-check-line text-gold-600 text-xl"></i>
                        </div>
                        <span className="text-gray-700 font-medium mt-2">{feature}</span>
                      </li>
                    )) : (
                      <p className="text-gray-500 italic col-span-2">No specific features listed for this product.</p>
                    )}
                  </ul>
                </div>
              )}

              {activeTab === 'reviews' && (
                <div className="animate-fade-in-up">
                  <ProductReviews productId={product.id} />
                </div>
              )}
            </div>
          </div>
        </section>

        {relatedProducts.length > 0 && (
          <section className="py-24 bg-gray-50 border-t border-gray-100" data-product-shop>
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              <div className="text-center mb-16">
                <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4 tracking-tight">You May Also Like</h2>
                <div className="w-24 h-1 bg-gold-600 mx-auto rounded-full mb-6"></div>
                <p className="text-lg text-gray-600">Curated recommendations based on your selection</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                {relatedProducts.map((p, idx) => (
                  <div key={p.id} className="animate-fade-in-up" style={{ animationDelay: `${idx * 100}ms` }}>
                    <ProductCard {...p} />
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
