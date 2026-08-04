-- Store-wide promotions + make loyalty rules read from store_settings.

INSERT INTO public.store_settings (key, value, description) VALUES
  ('storewide_sale_enabled', 'false'::jsonb, 'Apply a store-wide % off all products at checkout and on the storefront'),
  ('storewide_sale_percent', '0'::jsonb, 'Store-wide sale percentage (0-100)'),
  ('storewide_sale_name', '""'::jsonb, 'Optional label for the store-wide sale (e.g. Black Friday)'),
  ('global_delivery_discount_percent', '0'::jsonb, 'Percent off delivery fees across ALL zones (0-100)'),
  ('free_delivery_min_items', '0'::jsonb, 'Free delivery when cart item quantity is at least this number (0 = disabled)'),
  ('loyalty_enabled', 'true'::jsonb, 'Whether Sleek Points earning and redemption are active'),
  ('loyalty_point_value_ghs', '1'::jsonb, 'GH₵ discount value of one Sleek Point at checkout')
ON CONFLICT (key) DO NOTHING;

-- Ensure expiry column exists (idempotent with prior migration).
ALTER TABLE public.loyalty_points
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Award points from store_settings so admin can pause / change rates without redeploying.
CREATE OR REPLACE FUNCTION award_loyalty_points()
RETURNS TRIGGER AS $$
DECLARE
  total_items INTEGER;
  points_to_award INTEGER;
  user_points_exists BOOLEAN;
  points_per_item INTEGER := 5;
  expiry_months INTEGER := 6;
  program_enabled BOOLEAN := true;
  raw jsonb;
BEGIN
  IF NEW.status = 'delivered' AND COALESCE(OLD.status::text, '') <> 'delivered' THEN
    -- Read live settings (fall back to defaults when missing).
    SELECT value INTO raw FROM public.store_settings WHERE key = 'loyalty_enabled';
    IF raw IS NOT NULL THEN
      program_enabled := CASE
        WHEN jsonb_typeof(raw) = 'boolean' THEN (raw::text)::boolean
        WHEN raw::text IN ('"true"', 'true', '1') THEN true
        WHEN raw::text IN ('"false"', 'false', '0') THEN false
        ELSE true
      END;
    END IF;

    IF NOT program_enabled THEN
      RETURN NEW;
    END IF;

    SELECT value INTO raw FROM public.store_settings WHERE key = 'loyalty_points_per_item';
    IF raw IS NOT NULL THEN
      BEGIN
        points_per_item := GREATEST(0, COALESCE((raw #>> '{}')::integer, (raw::text)::integer, 5));
      EXCEPTION WHEN OTHERS THEN
        points_per_item := 5;
      END;
    END IF;

    SELECT value INTO raw FROM public.store_settings WHERE key = 'loyalty_expiry_months';
    IF raw IS NOT NULL THEN
      BEGIN
        expiry_months := GREATEST(1, COALESCE((raw #>> '{}')::integer, (raw::text)::integer, 6));
      EXCEPTION WHEN OTHERS THEN
        expiry_months := 6;
      END;
    END IF;

    SELECT COALESCE(SUM(quantity), 0) INTO total_items
    FROM public.order_items WHERE order_id = NEW.id;

    points_to_award := total_items * points_per_item;

    IF points_to_award > 0 AND NEW.user_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.loyalty_points WHERE user_id = NEW.user_id)
        INTO user_points_exists;

      IF user_points_exists THEN
        UPDATE public.loyalty_points
        SET points = points + points_to_award,
            lifetime_earned = lifetime_earned + points_to_award,
            expires_at = NOW() + make_interval(months => expiry_months),
            updated_at = NOW()
        WHERE user_id = NEW.user_id;
      ELSE
        INSERT INTO public.loyalty_points (user_id, points, lifetime_earned, expires_at)
        VALUES (NEW.user_id, points_to_award, points_to_award, NOW() + make_interval(months => expiry_months));
      END IF;

      INSERT INTO public.loyalty_transactions (user_id, order_id, amount, type, description)
      VALUES (
        NEW.user_id,
        NEW.id,
        points_to_award,
        'earn',
        format('Earned %s points for %s item(s) in order', points_to_award, total_items)
      );

      BEGIN
        UPDATE public.orders SET points_earned = points_to_award WHERE id = NEW.id;
      EXCEPTION WHEN undefined_column THEN
        NULL;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_award_loyalty_points ON public.orders;
CREATE TRIGGER trigger_award_loyalty_points
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION award_loyalty_points();
