-- Fix admin/staff RLS: UI admits operators via public.staff, but many policies
-- only called is_admin_or_staff() which previously checked profiles.role only.
-- Staff with profiles.role = 'customer' could open Product Editor then hit:
--   "new row violates row-level security policy for table 'products'"

CREATE OR REPLACE FUNCTION public.is_admin_or_staff()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Super-admins / legacy staff flagged on profiles
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role::text IN ('admin', 'staff')
  ) THEN
    RETURN TRUE;
  END IF;

  -- Staff-table operators (admin / manager / staff). Riders excluded on purpose.
  IF EXISTS (
    SELECT 1 FROM public.staff
    WHERE user_id = auth.uid()
      AND is_active IS TRUE
      AND role::text IN ('admin', 'manager', 'staff')
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.is_admin_or_staff() IS
  'True for profiles.role admin|staff OR active staff-table admin|manager|staff (not riders).';

-- Stock movements: ProductEditor inserts directly; was SELECT-only for staff.
DROP POLICY IF EXISTS "Staff view stock movements" ON public.stock_movements;
DROP POLICY IF EXISTS "Staff manage stock movements" ON public.stock_movements;
CREATE POLICY "Staff manage stock movements" ON public.stock_movements
  FOR ALL
  USING (public.is_admin_or_staff())
  WITH CHECK (public.is_admin_or_staff());

-- CMS / site tables were admin-profile-only; staff with settings perms need write access.
DO $$
BEGIN
  IF to_regclass('public.banners') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Allow admin all on banners" ON public.banners;
    CREATE POLICY "Staff manage banners" ON public.banners
      FOR ALL USING (public.is_admin_or_staff()) WITH CHECK (public.is_admin_or_staff());
  END IF;

  IF to_regclass('public.cms_content') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Allow admin all on cms_content" ON public.cms_content;
    CREATE POLICY "Staff manage cms_content" ON public.cms_content
      FOR ALL USING (public.is_admin_or_staff()) WITH CHECK (public.is_admin_or_staff());
  END IF;

  IF to_regclass('public.navigation_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Allow admin all on navigation_items" ON public.navigation_items;
    CREATE POLICY "Staff manage navigation_items" ON public.navigation_items
      FOR ALL USING (public.is_admin_or_staff()) WITH CHECK (public.is_admin_or_staff());
  END IF;

  IF to_regclass('public.navigation_menus') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Allow admin all on navigation_menus" ON public.navigation_menus;
    CREATE POLICY "Staff manage navigation_menus" ON public.navigation_menus
      FOR ALL USING (public.is_admin_or_staff()) WITH CHECK (public.is_admin_or_staff());
  END IF;

  IF to_regclass('public.site_settings') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Allow admin write on site_settings" ON public.site_settings;
    CREATE POLICY "Staff manage site_settings" ON public.site_settings
      FOR ALL USING (public.is_admin_or_staff()) WITH CHECK (public.is_admin_or_staff());
  END IF;
END $$;

-- Loyalty redemption at checkout updates the caller's own balance.
DO $$
BEGIN
  IF to_regclass('public.loyalty_points') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users update own points" ON public.loyalty_points;
    CREATE POLICY "Users update own points" ON public.loyalty_points
      FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF to_regclass('public.loyalty_transactions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users insert own transactions" ON public.loyalty_transactions;
    CREATE POLICY "Users insert own transactions" ON public.loyalty_transactions
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
