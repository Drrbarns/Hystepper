-- Premium package modules: product bundles + store_modules seed rows.

CREATE TABLE IF NOT EXISTS public.product_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  related_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(product_id, related_product_id),
  CHECK (product_id <> related_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_bundles_product_id ON public.product_bundles(product_id);

ALTER TABLE public.product_bundles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage product bundles" ON public.product_bundles;
CREATE POLICY "Staff manage product bundles" ON public.product_bundles
  FOR ALL
  USING (public.is_admin_or_staff())
  WITH CHECK (public.is_admin_or_staff());

DROP POLICY IF EXISTS "Public read product bundles" ON public.product_bundles;
CREATE POLICY "Public read product bundles" ON public.product_bundles
  FOR SELECT
  USING (true);

GRANT SELECT ON public.product_bundles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_bundles TO authenticated, service_role;

-- Seed premium module toggles (defaults per package spec).
INSERT INTO public.store_modules (id, enabled) VALUES
  ('notifications', false),
  ('blog', false),
  ('product-bundles', false),
  ('abandoned-cart', false),
  ('welcome-emails', true),
  ('review-requests', true),
  ('conversion-tracking', false),
  ('on-page-seo', true),
  ('monthly-reports', false)
ON CONFLICT (id) DO NOTHING;
