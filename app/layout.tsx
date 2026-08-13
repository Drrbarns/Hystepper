import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { CartProvider } from "@/context/CartContext";
import { WishlistProvider } from "@/context/WishlistContext";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://hystepper.com';
/** Cache-bust when brand assets change — forces browsers / PWAs to fetch new icons. */
const ICON_V = '20260813b';
const LOGO = `/brand/hy-stepper-logo.png?v=${ICON_V}`;
const OG = `/og-share.png?v=${ICON_V}`;
const ICON_192 = `/icon-192.png?v=${ICON_V}`;
const ICON_512 = `/icon-512.png?v=${ICON_V}`;
const APPLE = `/apple-touch-icon.png?v=${ICON_V}`;

export const viewport: Viewport = {
  themeColor: '#e82177',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Hy-Stepper | Stay Sleek in Style",
    template: "%s | Hy-Stepper"
  },
  description: "Premium footwear & accessories for the modern woman. Shop heels, sneakers, bags and more — with fast delivery across Ghana.",
  keywords: [
    "Hy-Stepper", "Hy_stepper", "women's shoes Ghana", "heels Accra", "sneakers Ghana",
    "buy shoes online Ghana", "premium footwear Ghana", "ladies bags Accra",
    "fashion accessories Ghana", "online shoe store Ghana", "delivery Accra"
  ],
  authors: [{ name: "Hy-Stepper" }],
  creator: "Hy-Stepper",
  publisher: "Hy-Stepper",
  category: "Shopping",
  applicationName: "Hy-Stepper",
  appleWebApp: {
    capable: true,
    title: "Hy-Stepper",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: `/favicon.ico?v=${ICON_V}`, sizes: 'any' },
      { url: `/favicon-16.png?v=${ICON_V}`, sizes: '16x16', type: 'image/png' },
      { url: `/favicon-32.png?v=${ICON_V}`, sizes: '32x32', type: 'image/png' },
      { url: `/favicon-48.png?v=${ICON_V}`, sizes: '48x48', type: 'image/png' },
      { url: ICON_192, sizes: '192x192', type: 'image/png' },
      { url: ICON_512, sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: APPLE, sizes: '180x180', type: 'image/png' }],
    shortcut: [`/favicon.ico?v=${ICON_V}`],
    other: [
      { rel: 'mask-icon', url: `/brand/hy-stepper-mark.png?v=${ICON_V}` },
    ],
  },
  manifest: `/manifest.webmanifest`,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: "website",
    locale: "en_GH",
    url: SITE_URL,
    title: "Hy-Stepper | Stay Sleek in Style",
    description: "Premium footwear & accessories for the modern woman. Shop heels, sneakers, bags and more — with fast delivery across Ghana.",
    siteName: "Hy-Stepper",
    images: [
      {
        url: OG,
        width: 1200,
        height: 630,
        alt: "Hy-Stepper — Stay sleek in style",
        type: "image/png",
      },
      {
        url: LOGO,
        width: 1024,
        height: 723,
        alt: "Hy-Stepper logo",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Hy-Stepper | Stay Sleek in Style",
    description: "Premium footwear & accessories for the modern woman. Fast delivery across Ghana.",
    images: [OG],
    creator: "@hystepper",
  },
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Hy-Stepper",
  url: SITE_URL,
  logo: `${SITE_URL}${LOGO}`,
  image: `${SITE_URL}${OG}`,
  description: "Premium footwear & accessories for the modern woman. Fast delivery across Ghana.",
  contactPoint: {
    "@type": "ContactPoint",
    telephone: "+233276558163",
    contactType: "Customer Service",
    areaServed: "GH",
    availableLanguage: ["English"],
  },
  address: {
    "@type": "PostalAddress",
    addressLocality: "Accra",
    addressCountry: "GH",
  },
  sameAs: [
    "https://instagram.com/hystepper",
    "https://facebook.com/hystepper",
    "https://twitter.com/hystepper",
  ],
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Hy-Stepper",
  url: SITE_URL,
  description: "Premium footwear & accessories for the modern woman.",
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_URL}/shop?search={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GH">
      <head>
        {/* Force brand icons even when browsers cache old /icon generators */}
        <link rel="icon" href={`/favicon.ico?v=${ICON_V}`} sizes="any" />
        <link rel="icon" type="image/png" sizes="16x16" href={`/favicon-16.png?v=${ICON_V}`} />
        <link rel="icon" type="image/png" sizes="32x32" href={`/favicon-32.png?v=${ICON_V}`} />
        <link rel="icon" type="image/png" sizes="48x48" href={`/favicon-48.png?v=${ICON_V}`} />
        <link rel="icon" type="image/png" sizes="192x192" href={ICON_192} />
        <link rel="icon" type="image/png" sizes="512x512" href={ICON_512} />
        <link rel="apple-touch-icon" sizes="180x180" href={APPLE} />
        <link rel="shortcut icon" href={`/favicon.ico?v=${ICON_V}`} />
        <meta name="msapplication-TileImage" content={ICON_192} />
        <meta name="msapplication-TileColor" content="#e82177" />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://cdn.jsdelivr.net/npm/remixicon@4.5.0/fonts/remixicon.min.css"
          rel="stylesheet"
        />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
        />
      </head>
      <body className="antialiased font-sans overflow-x-hidden">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[10000] focus:px-6 focus:py-3 focus:bg-emerald-700 focus:text-white focus:rounded-lg focus:font-semibold focus:shadow-lg"
        >
          Skip to main content
        </a>
        <CartProvider>
          <WishlistProvider>
            <div id="main-content">
              {children}
            </div>
          </WishlistProvider>
        </CartProvider>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
