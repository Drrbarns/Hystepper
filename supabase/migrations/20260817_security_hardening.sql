-- Production security hardening (2026-08-17)
-- Revoke client-callable payment finalization, lock profile role escalation,
-- tighten guest/loyalty/coupon policies, add server-side checkout RPCs.

-- ---------------------------------------------------------------------------
-- Payment finalization: service_role only
-- Signatures: mark_order_paid(TEXT, TEXT), finalize_zero_payment_order(uuid)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.mark_order_paid(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(TEXT, TEXT) TO service_role;

-- Revoke anonymous stock mutation (authenticated admin UI may still call;
-- webhooks use service_role).
REVOKE ALL ON FUNCTION public.decrement_order_stock(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decrement_order_stock(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Profile role self-escalation guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_profile_role_escalation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Not allowed to change profile role';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prevent_profile_role_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_role_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_role_escalation();

-- ---------------------------------------------------------------------------
-- Guest order PII: drop overly broad guest SELECT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Enable select for guest orders" ON public.orders;

-- ---------------------------------------------------------------------------
-- Loyalty: remove client self-update of points
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users update own points" ON public.loyalty_points;

-- ---------------------------------------------------------------------------
-- Coupons: remove user update of coupons
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update coupon usage count" ON public.coupons;

-- ---------------------------------------------------------------------------
-- Server-side checkout helpers (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_coupon_usage(coupon_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF coupon_id IS NULL THEN
    RAISE EXCEPTION 'coupon id required';
  END IF;

  UPDATE public.coupons
  SET usage_count = COALESCE(usage_count, 0) + 1,
      updated_at = now()
  WHERE id = coupon_id
    AND is_active IS TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_coupon_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_coupon_usage(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.redeem_loyalty_points(
  p_user_id uuid,
  p_points int,
  p_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_balance int;
BEGIN
  IF p_user_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'user and order required';
  END IF;

  IF COALESCE(p_points, 0) <= 0 THEN
    RETURN;
  END IF;

  SELECT points INTO current_balance
  FROM public.loyalty_points
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR COALESCE(current_balance, 0) < p_points THEN
    RAISE EXCEPTION 'insufficient loyalty points';
  END IF;

  UPDATE public.loyalty_points
  SET points = GREATEST(0, COALESCE(points, 0) - p_points),
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.loyalty_transactions (user_id, order_id, amount, type, description)
  VALUES (
    p_user_id,
    p_order_id,
    -p_points,
    'redemption',
    format('Redeemed %s points on order %s', p_points, p_order_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_loyalty_points(uuid, int, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_loyalty_points(uuid, int, uuid) TO service_role;
