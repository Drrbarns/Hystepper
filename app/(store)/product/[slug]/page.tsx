import ProductDetailClient from './ProductDetailClient';
import { createClient } from '@supabase/supabase-js';
import type { Metadata } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://hystepper.vercel.app';

async function getProduct(slug: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data } = await supabase
    .from('products')
    .select('name, description, price, compare_at_price, product_images(url, position), categories(name, slug)')
    .eq('slug', slug)
    .order('position', { foreignTable: 'product_images', ascending: true })
    .limit(1, { foreignTable: 'product_images' })
    .single();
  return data;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);

  if (!product) {
    return { title: 'Product Not Found | Hy_stepper' };
  }

  const mainImage = product.product_images
    ?.sort((a: any, b: any) => (a.position || 0) - (b.position || 0))[0]?.url
    || `${SITE_URL}/og-share.png?v=20260813`;

  const rawDesc = product.description
    ? product.description.replace(/<[^>]+>/g, '').trim()
    : '';

  const description = rawDesc
    ? rawDesc.substring(0, 155) + (rawDesc.length > 155 ? '…' : '')
    : `Shop ${product.name} at Hy_stepper. Premium footwear & accessories delivered across Ghana.`;

  const canonicalUrl = `${SITE_URL}/product/${slug}`;

  return {
    title: `${product.name} — Shop Now`,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${product.name} | Hy_stepper`,
      description,
      type: 'website',
      url: canonicalUrl,
      siteName: 'Hy_stepper',
      locale: 'en_GH',
      images: [
        {
          url: mainImage,
          width: 800,
          height: 800,
          alt: `${product.name} — Hy_stepper`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${product.name} | Hy_stepper`,
      description,
      images: [mainImage],
      creator: '@hystepper',
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
    },
  };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ProductDetailClient slug={slug} />;
}
