-- New Arrival curation + sales-based popularity for shop sorting.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_new_arrival boolean NOT NULL DEFAULT false;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sales_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.products.is_new_arrival IS
  'When true, product appears under Shop → New Arrivals / Newest sort';
COMMENT ON COLUMN public.products.sales_count IS
  'Units sold from paid, non-cancelled orders — drives Most Popular sort';

-- Backfill sales from historical paid orders.
UPDATE public.products p
SET sales_count = COALESCE(s.qty, 0)
FROM (
  SELECT oi.product_id, SUM(oi.quantity)::integer AS qty
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.payment_status = 'paid'
    AND COALESCE(o.status::text, '') NOT IN ('cancelled', 'refunded')
    AND oi.product_id IS NOT NULL
  GROUP BY oi.product_id
) s
WHERE p.id = s.product_id;

CREATE INDEX IF NOT EXISTS idx_products_sales_count
  ON public.products (sales_count DESC);

CREATE INDEX IF NOT EXISTS idx_products_is_new_arrival
  ON public.products (is_new_arrival)
  WHERE is_new_arrival = true;

-- Keep sales_count in sync when an order becomes paid (or is unpaid/cancelled).
CREATE OR REPLACE FUNCTION public.sync_product_sales_count()
RETURNS TRIGGER AS $$
DECLARE
  was_counted boolean;
  is_counted boolean;
  delta integer;
  r record;
BEGIN
  was_counted := (
    TG_OP = 'UPDATE'
    AND COALESCE(OLD.payment_status::text, '') = 'paid'
    AND COALESCE(OLD.status::text, '') NOT IN ('cancelled', 'refunded')
  );
  is_counted := (
    COALESCE(NEW.payment_status::text, '') = 'paid'
    AND COALESCE(NEW.status::text, '') NOT IN ('cancelled', 'refunded')
  );

  IF was_counted = is_counted THEN
    RETURN NEW;
  END IF;

  delta := CASE WHEN is_counted AND NOT was_counted THEN 1
                WHEN was_counted AND NOT is_counted THEN -1
                ELSE 0 END;
  IF delta = 0 THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT product_id, SUM(quantity)::integer AS qty
    FROM public.order_items
    WHERE order_id = NEW.id AND product_id IS NOT NULL
    GROUP BY product_id
  LOOP
    UPDATE public.products
    SET sales_count = GREATEST(0, sales_count + (r.qty * delta))
    WHERE id = r.product_id;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_sync_product_sales_count ON public.orders;
CREATE TRIGGER trigger_sync_product_sales_count
  AFTER UPDATE OF payment_status, status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_product_sales_count();
