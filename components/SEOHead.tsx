import { Metadata } from 'next';

const SITE_NAME = 'Hy-Stepper';
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://hystepper.com';
const OG_IMAGE = `${SITE_URL}/og-share.png?v=20260813b`;

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string[];
  ogImage?: string;
  ogType?: 'website' | 'article';
  publishedTime?: string;
  author?: string;
  noindex?: boolean;
  canonical?: string;
}

const DEFAULT_KEYWORDS = [
  'women shoes Ghana',
  'heels Accra',
  'buy shoes online Ghana',
  'premium footwear Ghana',
  'ladies bags Accra',
  'fashion accessories Ghana',
  'online shoe store Ghana',
  'fast delivery Accra',
];

export function generateMetadata({
  title = 'Premium Footwear & Accessories',
  description = 'Shop premium footwear & accessories for the modern woman. Fast delivery across Ghana.',
  keywords = [],
  ogImage = OG_IMAGE,
  ogType = 'website',
  publishedTime,
  author,
  noindex = false,
  canonical,
}: SEOProps = {}): Metadata {
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
  const allKeywords = [...new Set([...keywords, ...DEFAULT_KEYWORDS])];
  const canonicalUrl = canonical || SITE_URL;

  const base: Metadata = {
    title: fullTitle,
    description,
    keywords: allKeywords.join(', '),
    authors: author ? [{ name: author }] : [{ name: SITE_NAME }],
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: fullTitle,
      description,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      type: ogType,
      siteName: SITE_NAME,
      locale: 'en_GH',
      url: canonicalUrl,
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [ogImage],
      creator: '@hystepper',
    },
    robots: noindex
      ? { index: false, follow: false }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            'max-image-preview': 'large',
            'max-snippet': -1,
          },
        },
  };

  if (ogType === 'article' && publishedTime && base.openGraph) {
    base.openGraph = { ...base.openGraph, type: 'article', publishedTime };
  }

  return base;
}

export function generateProductSchema(product: {
  name: string;
  description: string;
  image: string;
  price: number;
  currency?: string;
  sku?: string;
  rating?: number;
  reviewCount?: number;
  availability?: string;
  brand?: string;
  category?: string;
  slug?: string;
}) {
  const productUrl = product.slug
    ? `${SITE_URL}/product/${product.slug}`
    : SITE_URL;

  const schema: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.image,
    sku: product.sku || product.name.toLowerCase().replace(/\s+/g, '-'),
    brand: {
      '@type': 'Brand',
      name: product.brand || SITE_NAME,
    },
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: product.currency || 'GHS',
      availability:
        product.availability === 'in_stock'
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      url: productUrl,
      seller: {
        '@type': 'Organization',
        name: SITE_NAME,
      },
      priceValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
    },
  };

  if (product.rating && product.reviewCount) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.rating,
      reviewCount: product.reviewCount,
      bestRating: 5,
      worstRating: 1,
    };
  }

  if (product.category) {
    schema.category = product.category;
  }

  return schema;
}

export function generateBreadcrumbSchema(
  items: { name: string; url: string }[]
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function generateOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: OG_IMAGE,
    description:
      'Premium footwear & accessories for the modern woman. Fast delivery across Ghana.',
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: '+233276558163',
      contactType: 'Customer Service',
      areaServed: 'GH',
      availableLanguage: ['English'],
    },
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Accra',
      addressCountry: 'GH',
    },
    sameAs: [
      'https://instagram.com/hystepper',
      'https://facebook.com/hystepper',
      'https://twitter.com/hystepper',
    ],
  };
}

export function generateWebsiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/shop?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

// Server component — renders JSON-LD script tags
export function StructuredData({ data }: { data: Record<string, any> | Record<string, any>[] }) {
  const jsonString = JSON.stringify(Array.isArray(data) ? data : data);
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonString }}
    />
  );
}
