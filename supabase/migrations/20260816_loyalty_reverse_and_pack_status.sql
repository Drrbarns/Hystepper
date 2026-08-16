-- Reverse Sleek Points when an order is cancelled or returned after points were earned.
-- Also expose an RPC to recalculate expires_at from the current loyalty_expiry_months setting.

CREATE OR REPLACE FUNCTION award_loyalty_points()
RETURNS TRIGGER AS $$
DECLARE
  total_items INTEGER;
  points_to_award INTEGER;
  points_to_reverse INTEGER;
  user_points_exists BOOLEAN;
  points_per_item INTEGER := 5;
  expiry_months INTEGER := 6;
  program_enabled BOOLEAN := true;
  raw jsonb;
  already_reversed BOOLEAN;
BEGIN
  -- Earn on first transition to delivered
  IF NEW.status = 'delivered' AND COALESCE(OLD.status::text, '') <> 'delivered' THEN
    SELECT value INTO raw FROM public.store_settings WHERE key = 'loyalty_enabled';
    IF raw IS NOT NULL THEN
      program_enabled := CASE
        WHEN jsonb_typeof(raw) = 'boolean' THEN (raw::text)::boolean
        WHEN raw::text IN ('"true"', 'true', '1') THEN true
        WHEN raw::text IN ('"false"', 'false', '0') THEN false
        ELSE true
      END;
    END IF;

    IF program_enabled THEN
      SELECT value INTO raw FROM public.store_settings WHERE key = 'loyalty_points_per_item';
      IF raw IS NOT NULL THEN
        BEGIN
          points_per_item := GREATEST(0, COALESCE((raw #>> '{}')::integer, 5));
        EXCEPTION WHEN OTHERS THEN
          points_per_item := 5;
        END;
      END IF;

      SELECT value INTO raw FROM public.store_settings WHERE key = 'loyalty_expiry_months';
      IF raw IS NOT NULL THEN
        BEGIN
          expiry_months := GREATEST(1, COALESCE((raw #>> '{}')::integer, 6));
        EXCEPTION WHEN OTHERS THEN
          expiry_months := 6;
        END;
      END IF;

      SELECT COALESCE(SUM(quantity), 0) INTO total_items
      FROM public.order_items WHERE order_id = NEW.id
        AND COALESCE(status::text, '') NOT IN ('cancelled', 'returned');

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
  END IF;

  -- Reverse earned points when cancelling / returning after they were credited
  IF NEW.status::text IN ('cancelled', 'returned')
     AND COALESCE(OLD.status::text, '') NOT IN ('cancelled', 'returned')
     AND NEW.user_id IS NOT NULL THEN

    points_to_reverse := COALESCE(NEW.points_earned, 0);
    IF points_to_reverse <= 0 THEN
      -- Fall back to summing earn txs for this order
      SELECT COALESCE(SUM(amount), 0) INTO points_to_reverse
      FROM public.loyalty_transactions
      WHERE order_id = NEW.id AND type = 'earn' AND amount > 0;
    END IF;

    IF points_to_reverse > 0 THEN
      -- Idempotency: any negative forfeit already recorded for this order
      SELECT EXISTS(
        SELECT 1 FROM public.loyalty_transactions
        WHERE order_id = NEW.id AND type = 'forfeit' AND amount < 0
      ) INTO already_reversed;

      IF NOT already_reversed THEN
        UPDATE public.loyalty_points
        SET points = GREATEST(0, points - points_to_reverse),
            updated_at = NOW()
        WHERE user_id = NEW.user_id;

        INSERT INTO public.loyalty_transactions (user_id, order_id, amount, type, description)
        VALUES (
          NEW.user_id,
          NEW.id,
          -points_to_reverse,
          'forfeit',
          format('Reversed %s points because order was %s', points_to_reverse, NEW.status::text)
        );
      END IF;
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

-- Recalculate every customer's expires_at from the current expiry setting
-- (relative to updated_at / last earn activity).
CREATE OR REPLACE FUNCTION public.recalc_loyalty_expiry()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  expiry_months INTEGER := 6;
  raw jsonb;
  updated_count INTEGER := 0;
BEGIN
  SELECT value INTO raw FROM public.store_settings WHERE key = 'loyalty_expiry_months';
  IF raw IS NOT NULL THEN
    BEGIN
      expiry_months := GREATEST(1, COALESCE((raw #>> '{}')::integer, 6));
    EXCEPTION WHEN OTHERS THEN
      expiry_months := 6;
    END;
  END IF;

  UPDATE public.loyalty_points
  SET expires_at = COALESCE(updated_at, NOW()) + make_interval(months => expiry_months);
  -- Do not touch updated_at — that marks last earn/redeem activity.

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_loyalty_expiry() TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_loyalty_expiry() TO service_role;

-- Collapse Packaging for Delivery into Packed (same operational step).
DO $$
BEGIN
  UPDATE public.orders
  SET status = 'packed'
  WHERE status::text = 'packaging_for_delivery';
EXCEPTION WHEN OTHERS THEN
  -- Enum may still include the value; update via text cast if needed
  BEGIN
    EXECUTE $q$UPDATE public.orders SET status = 'packed' WHERE status::text = 'packaging_for_delivery'$q$;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;
