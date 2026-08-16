export type StoreModuleDef = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  adminPath?: string;
  defaultEnabled?: boolean;
};

/** Active modules shown in /admin/modules */
export const STORE_MODULES: StoreModuleDef[] = [
  // Marketing & automation
  {
    id: 'notifications',
    name: 'Marketing Notifications',
    description: 'Send Email and SMS campaigns to customers',
    icon: 'ri-notification-3-line',
    color: 'red',
    category: 'Marketing',
    adminPath: '/admin/notifications',
  },
  {
    id: 'blog',
    name: 'Blog Management',
    description: 'Create and manage blog posts',
    icon: 'ri-article-line',
    color: 'emerald',
    category: 'Marketing',
    adminPath: '/admin/blog',
  },
  {
    id: 'product-bundles',
    name: 'Product Bundles / Bought Together',
    description: 'Suggest frequently bought-together products on product pages',
    icon: 'ri-shopping-basket-2-line',
    color: 'orange',
    category: 'Marketing',
    adminPath: '/admin/bundles',
  },
  {
    id: 'abandoned-cart',
    name: 'Abandoned Cart Recovery',
    description: 'Automatically email customers who start checkout but do not pay',
    icon: 'ri-shopping-cart-line',
    color: 'amber',
    category: 'Marketing',
    adminPath: '/admin/abandoned-cart',
  },
  {
    id: 'welcome-emails',
    name: 'Welcome Emails',
    description: 'Send a branded welcome email when a customer signs up',
    icon: 'ri-mail-send-line',
    color: 'blue',
    category: 'Marketing',
  },
  {
    id: 'review-requests',
    name: 'Review Request Emails',
    description: 'Automatically ask for a review when an order is delivered',
    icon: 'ri-star-smile-line',
    color: 'yellow',
    category: 'Marketing',
  },
  // Growth
  {
    id: 'conversion-tracking',
    name: 'Conversion Tracking (GA4 + Meta Pixel)',
    description: 'Enable Google Analytics 4 and Facebook/Meta Pixel purchase tracking',
    icon: 'ri-line-chart-line',
    color: 'indigo',
    category: 'Growth',
    adminPath: '/admin/settings',
  },
  {
    id: 'on-page-seo',
    name: 'On-page SEO',
    description: 'Use product SEO titles, meta descriptions, and clean URLs on the storefront',
    icon: 'ri-search-eye-line',
    color: 'purple',
    category: 'Growth',
  },
  {
    id: 'monthly-reports',
    name: 'Monthly Optimisation Report',
    description: 'Generate a monthly sales and performance summary for the business',
    icon: 'ri-file-chart-line',
    color: 'emerald',
    category: 'Analytics',
    adminPath: '/admin/monthly-report',
  },
];

/*
 * UNUSED / STUB MODULES — commented out (kept for reference, not shown in UI):
 *
 * { id: 'cms', name: 'CMS / Pages', description: 'Manage website content, policies, and landing pages', icon: 'ri-file-list-line', color: 'blue', category: 'Content' },
 * { id: 'homepage', name: 'Homepage Config', description: 'Customize homepage sections and banners', icon: 'ri-home-gear-line', color: 'purple', category: 'Content' }, // managed under Settings → Hero
 * { id: 'flash-sales', name: 'Flash Sales', description: 'Time-limited promotional sales with countdown timers', icon: 'ri-flashlight-line', color: 'amber', category: 'Marketing' }, // stub; use Promotions storewide sale
 * { id: 'loyalty-program', name: 'Loyalty Program', description: 'Points and rewards system for customer retention', icon: 'ri-trophy-line', color: 'yellow', category: 'Marketing' }, // managed under Promotions
 * { id: 'pwa-settings', name: 'PWA / Mobile App', description: 'Configure Progressive Web App settings', icon: 'ri-smartphone-line', color: 'indigo', category: 'Mobile' }, // unused stub
 * { id: 'customer-insights', name: 'Customer Insights', description: 'Advanced analytics on customer behavior', icon: 'ri-user-search-line', color: 'orange', category: 'Analytics' }, // optional analytics page
 */

export async function fetchEnabledModuleIds(client: { from: Function }): Promise<string[]> {
  const { data } = await client.from('store_modules').select('id, enabled');
  return (data || []).filter((m: { enabled?: boolean }) => m.enabled).map((m: { id: string }) => m.id);
}

export function isModuleEnabled(enabledIds: string[], moduleId: string): boolean {
  return enabledIds.includes(moduleId);
}

export function getModuleDef(moduleId: string): StoreModuleDef | undefined {
  return STORE_MODULES.find((m) => m.id === moduleId);
}
