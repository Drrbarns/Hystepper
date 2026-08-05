'use client';

import { useState } from 'react';
import Link from 'next/link';
import LazyImage from './LazyImage';
import { productImageSrc } from '@/lib/media-url';
import { useCart } from '@/context/CartContext';

interface ProductCardProps {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  rating?: number;
  reviewCount?: number;
  badge?: string;
  inStock?: boolean;
  colors?: { name: string; hex: string | null; image?: string | null }[];
  /** Eager-load hero row images (above the fold). */
  priority?: boolean;
}

export default function ProductCard({
  id,
  name,
  price,
  originalPrice,
  image,
  rating = 5,
  reviewCount = 0,
  badge,
  inStock = true,
  colors,
  priority = false,
}: ProductCardProps) {
  const { addToCart } = useCart();
  const discount = originalPrice ? Math.round((1 - price / originalPrice) * 100) : 0;
  const [hoveredColor, setHoveredColor] = useState<string | null>(null);

  const fallbackImage = typeof image === 'string' && image ? image : '/placeholder-product.png';
  const hoverColorImage = colors?.find(c => c?.name === hoveredColor)?.image;
  const displayImage = (hoveredColor && typeof hoverColorImage === 'string' && hoverColorImage)
    ? hoverColorImage
    : fallbackImage;
  const safeDisplayImage = typeof displayImage === 'string' && displayImage ? displayImage : fallbackImage;

  return (
    <div className="group bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 border border-transparent hover:border-gold-500/30 h-full flex flex-col">
      <Link href={`/product/${id}`} className="relative block aspect-square overflow-hidden bg-gray-100 flex-shrink-0">
        <LazyImage
          src={safeDisplayImage}
          alt={name || 'Product'}
          className="w-full h-full object-cover object-top group-hover:scale-110 transition-transform duration-500"
          thumbWidth={480}
          priority={priority}
        />
        {badge && (
          <span className="absolute top-3 left-3 bg-gold-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
            {badge}
          </span>
        )}
        {discount > 0 && (
          <span className="absolute top-3 right-3 bg-red-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
            -{discount}%
          </span>
        )}
        {!inStock && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
            <span className="text-gray-700 font-semibold text-lg">Out of Stock</span>
          </div>
        )}
      </Link>

      <div className="p-4 flex flex-col flex-grow">
        <Link href={`/product/${id}`}>
          <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2 group-hover:text-gold-600 transition-colors h-12 lg:h-auto">
            {name}
          </h3>
        </Link>

        {colors && colors.length > 0 && (
          <div className="flex items-center gap-1.5 mb-2" onMouseLeave={() => setHoveredColor(null)}>
            {colors.slice(0, 5).map((color) => {
              const cName = color?.name ?? '';
              const cHex = color?.hex ?? null;
              const cImage = typeof color?.image === 'string' && color.image ? color.image : null;

              if (cImage) {
                return (
                  <span
                    key={cName}
                    className={`w-7 h-7 rounded-md overflow-hidden border transition-transform duration-200 cursor-pointer ${hoveredColor === cName ? 'border-gold-500 scale-110 ring-1 ring-gold-300' : 'border-gray-200'}`}
                    title={cName}
                    onMouseEnter={() => setHoveredColor(cName)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={productImageSrc(cImage, { width: 160 })}
                      alt={cName}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </span>
                );
              }

              return (
                <span
                  key={cName || cHex}
                  className={`w-4 h-4 rounded-full border transition-transform duration-200 cursor-pointer ${hoveredColor === cName ? 'border-gold-500 scale-125 ring-1 ring-gold-300' : 'border-gray-300'}`}
                  style={{ backgroundColor: typeof cHex === 'string' ? cHex : '#ccc' }}
                  title={cName}
                ></span>
              );
            })}
            {colors.length > 5 && (
              <span className="text-xs text-gray-400">+{colors.length - 5}</span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mt-auto mb-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-lg lg:text-xl font-bold text-gray-900">GH₵{(Number(price) || 0).toFixed(2)}</span>
            {originalPrice != null && (
              <span className="text-xs lg:text-sm text-gray-400 line-through">GH₵{(Number(originalPrice) || 0).toFixed(2)}</span>
            )}
          </div>
        </div>

        <button
          onClick={(e) => {
            e.preventDefault();
            // Redirect to product page to select variants before adding to cart
            window.location.href = `/product/${id}`;
          }}
          className="w-full bg-gray-900 hover:bg-gold-600 text-white py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2 whitespace-nowrap text-sm lg:text-base cursor-pointer"
          disabled={!inStock}
        >
          <i className="ri-shopping-cart-line text-lg"></i>
          <span>{inStock ? 'Select Options' : 'Out of Stock'}</span>
        </button>
      </div>
    </div>
  );
}