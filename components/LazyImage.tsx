'use client';

import { useState } from 'react';
import { productImageSrc } from '@/lib/media-url';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
  onLoad?: () => void;
  fill?: boolean;
  sizes?: string;
  /** Requested thumb width for /storage images (default 480 for cards). */
  thumbWidth?: number;
  /** Use full original (product detail). */
  fullResolution?: boolean;
}

const FALLBACK_SRC = '/placeholder-product.png';

/**
 * Fast product imagery: host-relative storage + derived WebP thumbs.
 * Uses native <img> for /storage paths (avoids Next optimizer re-fetching
 * the full original before resizing — critical on mobile grids).
 */
export default function LazyImage({
  src,
  alt,
  className = '',
  width,
  height,
  priority = false,
  onLoad,
  fill,
  thumbWidth = 480,
  fullResolution = false,
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const raw = typeof src === 'string' && src.trim() ? src.trim() : FALLBACK_SRC;
  const isDataUrl = raw.startsWith('data:');
  const optimized = isDataUrl
    ? raw
    : fullResolution
      ? productImageSrc(raw, { width: 1080 })
      : productImageSrc(raw, { width: thumbWidth });
  const safeSrc = hasError ? FALLBACK_SRC : (optimized || FALLBACK_SRC);

  const handleLoad = () => {
    setIsLoaded(true);
    onLoad?.();
  };

  const handleError = () => {
    if (!hasError) {
      setHasError(true);
      setIsLoaded(true);
      onLoad?.();
    }
  };

  const useFill = fill || (!width && !height);

  return (
    <div className={`relative overflow-hidden ${className}`} style={!useFill ? { width, height } : undefined}>
      {!isLoaded && (
        <div className="absolute inset-0 bg-gray-100 animate-pulse" aria-hidden />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={safeSrc}
        alt={alt || 'Product'}
        width={width || thumbWidth}
        height={height || thumbWidth}
        className={`${useFill ? 'absolute inset-0 w-full h-full' : 'w-full h-full'} object-cover object-top transition-opacity duration-200 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={handleLoad}
        onError={handleError}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
      />
    </div>
  );
}
