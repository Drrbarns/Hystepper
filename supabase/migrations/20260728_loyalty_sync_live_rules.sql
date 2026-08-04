-- 2026-07-28 Loyalty: sync the live DB with the documented programme rules.
--
-- The production trigger still awarded FLOOR(subtotal / 10) points, but the
-- storefront (FAQ, order-success page) and the merchant-confirmed rules say:
--   • 5 points per item, credited when the order flips to 'delivered'
--   • redeemable from 15 points at checkout (1 point = GH₵ 1)
--   • points expire 6 months after the most recent earn
-- The loyalty_points table was also missing the expires_at column that the
-- intended trigger writes.

ALTER TABLE public.loyalty_points
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE OR REPLACE FUNCTION award_loyalty_points()
RETURNS TRIGGER AS $$
DECLARE
  total_items INTEGER;
  points_to_award INTEGER;
  user_points_exists BOOLEAN;
BEGIN
  -- Only fire when status changes into 'delivered' for the first time.
  IF NEW.status = 'delivered' AND COALESCE(OLD.status::text, '') <> 'delivered' THEN
    SELECT COALESCE(SUM(quantity), 0) INTO total_items
    FROM order_items WHERE order_id = NEW.id;

    points_to_award := total_items * 5;

    IF points_to_award > 0 AND NEW.user_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM loyalty_points WHERE user_id = NEW.user_id)
      INTO user_points_exists;

      IF user_points_exists THEN
        UPDATE loyalty_points
        SET
          points = points + points_to_award,
          lifetime_earned = lifetime_earned + points_to_award,
          expires_at = NOW() + INTERVAL '6 months',
          updated_at = NOW()
        WHERE user_id = NEW.user_id;
      ELSE
        INSERT INTO loyalty_points (user_id, points, lifetime_earned, expires_at)
        VALUES (NEW.user_id, points_to_award, points_to_award, NOW() + INTERVAL '6 months');
      END IF;

      INSERT INTO loyalty_transactions (user_id, order_id, amount, type, description)
      VALUES (
        NEW.user_id,
        NEW.id,
        points_to_award,
        'earn',
        'Earned ' || points_to_award || ' points (' || total_items || ' items × 5 pts) from Order #' || NEW.order_number
      );

      UPDATE orders SET points_earned = points_to_award WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_award_loyalty_points ON orders;
CREATE TRIGGER trigger_award_loyalty_points
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION award_loyalty_points();
