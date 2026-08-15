import { MetadataRoute } from 'next';

/** Bump when icons change so installed PWAs refresh. */
const ICON_V = '20260813b';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Hy_stepper',
    short_name: 'Hy_stepper',
    description: 'Premium footwear & accessories for the modern woman. Stay Sleek in Style.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#ffffff',
    theme_color: '#e82177',
    categories: ['shopping', 'lifestyle'],
    icons: [
      {
        src: `/favicon-32.png?v=${ICON_V}`,
        sizes: '32x32',
        type: 'image/png',
      },
      {
        src: `/icon-192.png?v=${ICON_V}`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `/icon-512.png?v=${ICON_V}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `/maskable-192.png?v=${ICON_V}`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: `/maskable-512.png?v=${ICON_V}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: `/apple-touch-icon.png?v=${ICON_V}`,
        sizes: '180x180',
        type: 'image/png',
      },
    ],
    screenshots: [
      {
        src: `/og-share.png?v=${ICON_V}`,
        sizes: '1200x630',
        type: 'image/png',
        form_factor: 'wide',
      },
    ],
  };
}
