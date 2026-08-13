import type { Metadata } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://hystepper.vercel.app';

export const metadata: Metadata = {
  title: 'Shop All Products',
  description: 'Browse our full collection of premium heels, sneakers, bags and accessories. Fast delivery to Accra and across Ghana.',
  keywords: [
    'shop shoes Ghana', 'buy heels online', 'women sneakers Ghana',
    'ladies bags online', 'fashion accessories Accra', 'premium footwear',
  ],
  alternates: { canonical: `${SITE_URL}/shop` },
  openGraph: {
    title: 'Shop All Products | Hy_stepper',
    description: 'Browse our full collection of premium heels, sneakers, bags and accessories. Fast delivery across Ghana.',
    type: 'website',
    url: `${SITE_URL}/shop`,
    siteName: 'Hy_stepper',
    locale: 'en_GH',
    images: [{ url: `${SITE_URL}/og-share.png?v=20260813`, width: 1200, height: 630, alt: 'Hy-Stepper Shop' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Shop All Products | Hy_stepper',
    description: 'Browse our full collection of premium heels, sneakers, bags and accessories.',
    images: [`${SITE_URL}/og-share.png?v=20260813`],
  },
};

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
