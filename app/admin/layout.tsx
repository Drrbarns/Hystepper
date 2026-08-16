'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase, signOutFully } from '@/lib/supabase';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import NotificationsBell from '@/components/admin/NotificationsBell';
import {
  clearAdminPreviewCookie,
  setAdminSessionCookie,
  syncAdminPreviewCookie,
} from '@/lib/admin-session-cookie';

// Maps each admin URL prefix to the permission key that grants access.
// Keys are matched longest-prefix-first; a value of null means "no permission
// required" (e.g. login). The dashboard (/admin) is intentionally NOT in this
// list — it is locked to super-admins only and handled separately below.
const PATH_PERMISSIONS: Array<[string, string | null]> = [
  ['/admin/login', null],
  // Account settings are available to every signed-in admin/staff so they
  // can update their own profile and password.
  ['/admin/account', null],
  ['/admin/orders', 'orders'],
  ['/admin/delivery', 'delivery'],
  ['/admin/rider', 'order_status'],
  ['/admin/pos', 'pos'],
  ['/admin/products', 'products'],
  ['/admin/categories', 'categories'],
  ['/admin/customers', 'customers'],
  ['/admin/customer-insights', 'customers'],
  ['/admin/messages', 'customers'],
  ['/admin/reviews', 'reviews'],
  ['/admin/inventory', 'inventory'],
  ['/admin/analytics', 'analytics'],
  ['/admin/coupons', 'coupons'],
  ['/admin/promotions', 'coupons'],
  ['/admin/notifications', 'notifications'],
  ['/admin/test-sms', 'notifications'],
  ['/admin/blog', 'blog'],
  ['/admin/modules', 'modules'],
  ['/admin/staff', 'staff'],
  ['/admin/settings', 'settings'],
];

// Special sentinel used by the route + menu logic to indicate the dashboard
// is super-admin-only.
const SUPER_ADMIN_ONLY = '__super_admin__';

function requiredPermissionFor(pathname: string): string | null | undefined {
  // The dashboard root ('/admin' exactly) is always super-admin only.
  if (pathname === '/admin') return SUPER_ADMIN_ONLY;
  for (const [prefix, perm] of PATH_PERMISSIONS) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return perm;
  }
  return undefined;
}

function firstAllowedPath(
  permissions: Record<string, boolean>,
  role: string | null
): string {
  if (role === 'rider') return '/admin/rider';
  for (const [path, perm] of PATH_PERMISSIONS) {
    if (path === '/admin/login') continue;
    // /admin/rider is the rider-only view; non-riders shouldn't be landed here
    // even if they happen to carry the order_status permission.
    if (path === '/admin/rider') continue;
    if (perm && permissions[perm]) return path;
  }
  return '/admin/login';
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [user, setUser] = useState<any>(null);

  // Module Filtering State
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  // Staff permissions (null = super admin, has full access)
  const [staffPermissions, setStaffPermissions] = useState<Record<string, boolean> | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [staffRole, setStaffRole] = useState<string | null>(null);

  // Maintenance mode
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceToggling, setMaintenanceToggling] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();

      if (pathname === '/admin/login') {
        // Still mint preview cookies if already signed in (e.g. refresh on login).
        if (session) {
          setAdminSessionCookie();
          await syncAdminPreviewCookie(session.access_token);
        }
        setIsLoading(false);
        return;
      }

      if (!session) {
        router.push('/admin/login');
        return;
      }

      setUser(session.user);
      setIsAuthenticated(true);
      // Lets middleware allow storefront preview while maintenance_mode is on.
      setAdminSessionCookie();
      await syncAdminPreviewCookie(session.access_token);

      // Check profile role — 'admin' = super admin with full access
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle();

      // Super admin short-circuit: full access, skip all other checks.
      if (profileRow?.role === 'admin') {
        setIsSuperAdmin(true);
        setStaffPermissions(null);
        setIsLoading(false);
        return;
      }

      // Not a super admin — must be a staff member with explicit permissions.
      const { data: staffRow } = await supabase
        .from('staff')
        .select('permissions, is_active, role')
        .eq('user_id', session.user.id)
        .maybeSingle();

      // No staff record AND no admin profile = not allowed in the admin area.
      // This plugs a leak where stale users with no staff row were getting
      // full access via the earlier "fallback to full dashboard" behaviour.
      if (!staffRow) {
        console.warn('[Admin] User has no staff record, signing out:', session.user.email);
        await clearAdminPreviewCookie();
        await signOutFully('/admin/login?error=no_access');
        return;
      }

      if (!staffRow.is_active) {
        await clearAdminPreviewCookie();
        await signOutFully('/admin/login?error=inactive');
        return;
      }

      setStaffRole(staffRow.role);

      if (staffRow.role === 'admin') {
        setIsSuperAdmin(true);
        setStaffPermissions(null);
        setIsLoading(false);
        return;
      }

      const perms: Record<string, boolean> = staffRow.permissions || {};
      setStaffPermissions(perms);

      // Riders only ever see their personal delivery queue (plus their own
      // account settings page so they can update their password).
      if (
        staffRow.role === 'rider' &&
        pathname !== '/admin/rider' &&
        !pathname.startsWith('/admin/account')
      ) {
        router.replace('/admin/rider');
        setIsLoading(false);
        return;
      }

      // Inverse: non-riders shouldn't access the rider-only view even if they
      // happen to carry the order_status permission.
      if (staffRow.role !== 'rider' && pathname.startsWith('/admin/rider')) {
        router.replace(firstAllowedPath(perms, staffRow.role));
        setIsLoading(false);
        return;
      }

      // Enforce per-page permissions. If the user typed a URL they don't have
      // access to, send them back to the first page they can see.
      const required = requiredPermissionFor(pathname);
      // Dashboard is super-admin-only; staff must never see business KPIs.
      const blocked =
        required === SUPER_ADMIN_ONLY
          ? true
          : (!!required && !perms[required]);
      if (blocked) {
        const next = firstAllowedPath(perms, staffRow.role);
        if (next === '/admin/login') {
          // Staff with zero allowed pages — sign them out cleanly.
          await clearAdminPreviewCookie();
          await signOutFully('/admin/login?error=no_access');
          return;
        }
        router.replace(next);
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
    }

    checkAuth();
  }, [pathname, router]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showUserMenu && !target.closest('.user-menu-container')) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu]);

  // Fetch Modules Effect
  useEffect(() => {
    async function fetchModules() {
      try {
        const { data, error } = await supabase.from('store_modules').select('id, enabled');
        if (error) {
          console.warn('Error fetching modules:', error);
          return;
        }
        if (data) {
          setEnabledModules(data.filter((m: any) => m.enabled).map((m: any) => m.id));
        }
      } catch (err) {
        console.warn('Fetch modules failed:', err);
      }
    }
    fetchModules();

    supabase.from('store_settings').select('key, value').eq('key', 'maintenance_mode').then(({ data }) => {
      data?.forEach((row: { key: string; value: unknown }) => {
        if (row.key === 'maintenance_mode') {
          const raw = row.value;
          const on =
            raw === true ||
            raw === 1 ||
            String(raw).trim().replace(/^"+|"+$/g, '').toLowerCase() === 'true';
          setMaintenanceEnabled(on);
        }
      });
    });
  }, []);

  // Screen size check for initial state
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const fn = () => setIsMobile(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  useEffect(() => {
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  }, []);

  useBodyScrollLock(isSidebarOpen && isMobile);

  const handleLogout = async () => {
    await clearAdminPreviewCookie();
    await signOutFully('/admin/login');
  };

  const handleToggleMaintenance = async () => {
    // Staff (non-super-admin) must not be able to toggle maintenance mode.
    if (!isSuperAdmin) {
      alert('Only a super admin can toggle maintenance mode.');
      return;
    }
    const next = !maintenanceEnabled;
    setMaintenanceToggling(true);
    try {
      // Keep preview cookies fresh so the admin can still open the storefront.
      setAdminSessionCookie();
      const { data: { session } } = await supabase.auth.getSession();
      await syncAdminPreviewCookie(session?.access_token);

      const { error } = await supabase.from('store_settings').upsert(
        // Store as real JSON boolean so middleware + UI parse consistently
        { key: 'maintenance_mode', value: next, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
      if (error) throw error;
      setMaintenanceEnabled(next);
    } catch (err) {
      console.error('Failed to toggle maintenance:', err);
      alert('Failed to update. Please try again.');
    } finally {
      setMaintenanceToggling(false);
    }
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">Loading Admin...</div>;
  }

  // If somehow we got here without auth, render nothing (router.push has fired
  // and will replace the page). Prevents flash of admin UI for rejected users.
  if (pathname !== '/admin/login' && !isAuthenticated) {
    return <div className="min-h-screen bg-gray-50" />;
  }

  // Non-admin staff whose current path they lack permission for: render blank
  // while the redirect is in flight.
  if (!isSuperAdmin && staffPermissions && pathname !== '/admin/login') {
    const required = requiredPermissionFor(pathname);
    if (required === SUPER_ADMIN_ONLY) {
      return <div className="min-h-screen bg-gray-50" />;
    }
    if (required && !staffPermissions[required]) {
      return <div className="min-h-screen bg-gray-50" />;
    }
    if (staffRole === 'rider' && pathname !== '/admin/rider') {
      return <div className="min-h-screen bg-gray-50" />;
    }
  }

  const menuItems = [
    { title: 'Dashboard',        icon: 'ri-dashboard-line',      path: '/admin',                  exact: true,  permKey: SUPER_ADMIN_ONLY },
    { title: 'Orders',           icon: 'ri-shopping-bag-line',   path: '/admin/orders',            badge: '',    permKey: 'orders' },
    { title: 'Delivery',         icon: 'ri-truck-line',          path: '/admin/delivery',                        permKey: 'delivery' },
    { title: 'My Deliveries',    icon: 'ri-e-bike-line',         path: '/admin/rider',                           permKey: 'order_status' },
    { title: 'POS System',       icon: 'ri-store-3-line',        path: '/admin/pos',                             permKey: 'pos' },
    { title: 'Products',         icon: 'ri-box-3-line',          path: '/admin/products',                        permKey: 'products' },
    { title: 'Categories',       icon: 'ri-folder-line',         path: '/admin/categories',                      permKey: 'categories' },
    { title: 'Customers',        icon: 'ri-group-line',          path: '/admin/customers',                       permKey: 'customers' },
    { title: 'Messages',         icon: 'ri-mail-open-line',      path: '/admin/messages',                        permKey: 'customers' },
    { title: 'Reviews',          icon: 'ri-chat-smile-2-line',   path: '/admin/reviews',                         permKey: 'reviews' },
    { title: 'Inventory',        icon: 'ri-stack-line',          path: '/admin/inventory',                       permKey: 'inventory' },
    { title: 'Analytics',        icon: 'ri-bar-chart-line',      path: '/admin/analytics',                       permKey: 'analytics' },
    { title: 'Coupons',          icon: 'ri-coupon-2-line',       path: '/admin/coupons',                         permKey: 'coupons' },
    { title: 'Promotions',       icon: 'ri-percent-line',        path: '/admin/promotions',                      permKey: 'coupons' },
    { title: 'Customer Insights',icon: 'ri-user-search-line',    path: '/admin/customer-insights', moduleId: 'customer-insights' },
    { title: 'Notifications',    icon: 'ri-notification-3-line', path: '/admin/notifications',     moduleId: 'notifications', permKey: 'notifications' },
    { title: 'SMS Debugger',     icon: 'ri-message-2-line',      path: '/admin/test-sms' },
    { title: 'Blog',             icon: 'ri-article-line',        path: '/admin/blog',              moduleId: 'blog', permKey: 'blog' },
    { title: 'Modules',          icon: 'ri-puzzle-line',         path: '/admin/modules',                         permKey: 'modules' },
    { title: 'Staff',            icon: 'ri-user-settings-line',  path: '/admin/staff',                           permKey: 'staff' },
    { title: 'Settings',         icon: 'ri-settings-3-line',     path: '/admin/settings',                        permKey: 'settings' },
  ];

  const visibleMenuItems = menuItems.filter(item => {
    if ((item as any).moduleId && !enabledModules.includes((item as any).moduleId)) return false;
    // Super-admin-only items (e.g. Dashboard) never show for staff.
    if ((item as any).permKey === SUPER_ADMIN_ONLY) return isSuperAdmin;
    if (isSuperAdmin || staffPermissions === null) return true;
    if (staffRole === 'rider') return (item as any).permKey === 'order_status';
    // Non-riders never see the rider-only "My Deliveries" item.
    if ((item as any).path === '/admin/rider') return false;
    // Hide items that have no declared permKey from non-admin staff — utility
    // pages like SMS Debugger should not leak to limited-access users.
    if (!(item as any).permKey) return false;
    return !!staffPermissions[(item as any).permKey];
  });

  // Special layout for Login Page
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden glass-overlay"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Mobile: Transform / Desktop: Width transition */}
      <aside
        className={`fixed top-0 left-0 z-40 h-screen bg-white border-r border-gray-200 transition-all duration-300
          w-64
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} 
          ${isSidebarOpen ? 'lg:w-64' : 'lg:w-0 lg:overflow-hidden'}
          lg:translate-x-0
        `}
      >
        <div className="h-full px-4 py-6 overflow-y-auto">
          <Link href="/admin" className="flex items-center mb-8 px-2 cursor-pointer gap-2">
            <span className="font-serif text-2xl font-bold tracking-tight text-gray-900">Hy_stepper</span>
            <span className="ml-1 text-sm font-semibold text-gray-500">ADMIN</span>
          </Link>

          <nav className="space-y-1">
            {visibleMenuItems.map((item) => {
              const isActive = item.exact ? pathname === item.path : pathname.startsWith(item.path);
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={() => window.innerWidth < 1024 && setIsSidebarOpen(false)} // Close on mobile click
                  className={`flex items-center justify-between px-4 py-3 rounded-lg transition-colors cursor-pointer ${isActive
                    ? 'bg-emerald-50 text-emerald-700 font-semibold'
                    : 'text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  <div className="flex items-center space-x-3">
                    <i className={`${item.icon} text-xl w-5 h-5 flex items-center justify-center`}></i>
                    <span>{item.title}</span>
                  </div>
                  {item.badge && (
                    <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-1 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="mt-8 pt-8 border-t border-gray-200 space-y-1">
            {/* Maintenance Mode Toggle — super admin only */}
            {isSuperAdmin && (
              <div className={`flex items-center justify-between px-4 py-3 rounded-lg ${maintenanceEnabled ? 'bg-amber-50' : 'bg-gray-50'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <i className={`text-lg shrink-0 ${maintenanceEnabled ? 'ri-tools-fill text-amber-600' : 'ri-store-2-line text-gray-600'}`}></i>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">Maintenance</p>
                    <p className="text-xs text-gray-500 truncate">{maintenanceEnabled ? 'Store offline' : 'Store live'}</p>
                  </div>
                </div>
                <button
                  onClick={handleToggleMaintenance}
                  disabled={maintenanceToggling}
                  className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${maintenanceEnabled ? 'bg-amber-500 focus:ring-amber-400' : 'bg-gray-300 focus:ring-gray-400'} ${maintenanceToggling ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                  title={maintenanceEnabled ? 'Bring store back online' : 'Enable maintenance mode'}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${maintenanceEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            )}
            <Link
              href="/"
              target="_blank"
              onClick={() => window.innerWidth < 1024 && setIsSidebarOpen(false)}
              className="flex items-center space-x-3 px-4 py-3 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
            >
              <i className="ri-external-link-line text-xl w-5 h-5 flex items-center justify-center"></i>
              <span>View Store</span>
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content — min-w-0 lets child tables scroll horizontally on mobile
          instead of clipping (overflow-hidden parents + wide tables). */}
      <div className={`transition-all duration-300 ml-0 min-w-0 ${isSidebarOpen ? 'lg:ml-64' : 'lg:ml-0'}`}>
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="px-4 py-4 lg:px-6 flex items-center justify-between">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="w-10 h-10 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
            >
              <i className={`${isSidebarOpen ? 'ri-menu-fold-line' : 'ri-menu-unfold-line'} text-xl`}></i>
            </button>

            <div className="flex items-center space-x-2 lg:space-x-4">
              <NotificationsBell />

              <div className="relative user-menu-container">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center space-x-2 lg:space-x-3 px-2 lg:px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                >
                  <div className="w-8 h-8 lg:w-9 lg:h-9 flex items-center justify-center bg-emerald-100 text-emerald-700 rounded-full font-semibold">
                    {user?.email?.charAt(0).toUpperCase() || 'A'}
                  </div>
                  <div className="text-left hidden md:block">
                    <p className="text-sm font-semibold text-gray-900">
                      {isSuperAdmin ? 'Super Admin' : 'Staff'}
                    </p>
                    <p className="text-xs text-gray-500 max-w-[100px] truncate">{user?.email}</p>
                  </div>
                  <i className="ri-arrow-down-s-line text-gray-600"></i>
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-20">
                    <Link
                      href="/admin/account"
                      onClick={() => setShowUserMenu(false)}
                      className="w-full flex items-center space-x-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left cursor-pointer"
                    >
                      <i className="ri-user-settings-line text-gray-600 w-5 h-5 flex items-center justify-center"></i>
                      <span className="text-gray-700">Account Settings</span>
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center space-x-3 px-4 py-3 hover:bg-gray-50 transition-colors border-t border-gray-200 text-left cursor-pointer"
                    >
                      <i className="ri-logout-box-line text-red-600 w-5 h-5 flex items-center justify-center"></i>
                      <span className="text-red-600">Logout</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="p-4 lg:p-6 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
