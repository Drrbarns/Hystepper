-- Remaining RLS write-path fixes after 20260729_fix_admin_staff_rls.

-- 1) Customers/guests need a safe way to mark zero-balance orders paid
--    (checkout path when payableNow <= 0). Direct UPDATE lacked a policy.
CREATE OR REPLACE FUNCTION public.finalize_zero_payment_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  o public.orders%ROWTYPE;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order id required';
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  -- Authed: must own the order. Guest: order must have null user_id.
  IF o.user_id IS NOT NULL THEN
    IF auth.uid() IS NULL OR o.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'not allowed';
    END IF;
  END IF;

  IF COALESCE(o.payment_status::text, '') = 'paid' THEN
    RETURN;
  END IF;

  -- Only zero-balance checkouts may use this path (points/coupon fully covered).
  IF COALESCE(o.total, 0) > 0 THEN
    RAISE EXCEPTION 'order still has a payable balance';
  END IF;

  UPDATE public.orders
  SET payment_status = 'paid',
      status = 'processing',
      updated_at = now()
  WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_zero_payment_order(uuid) TO anon, authenticated, service_role;

-- Also allow authenticated customers to update their own orders (payment webhooks
-- / edge cases that update via the user JWT).
DROP POLICY IF EXISTS "Users update own orders" ON public.orders;
CREATE POLICY "Users update own orders" ON public.orders
  FOR UPDATE
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- 2) store_modules — admin Modules page upserts here; table was missing on fleet.
CREATE TABLE IF NOT EXISTS public.store_modules (
  id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.store_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage store modules" ON public.store_modules;
CREATE POLICY "Staff manage store modules" ON public.store_modules
  FOR ALL
  USING (public.is_admin_or_staff())
  WITH CHECK (public.is_admin_or_staff());

DROP POLICY IF EXISTS "Staff read store modules" ON public.store_modules;
CREATE POLICY "Staff read store modules" ON public.store_modules
  FOR SELECT
  USING (public.is_admin_or_staff());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_modules TO authenticated, service_role;
GRANT SELECT ON public.store_modules TO anon;
