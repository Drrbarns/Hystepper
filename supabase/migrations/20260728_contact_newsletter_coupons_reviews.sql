-- 2026-07-28 batch fixes
-- 1. Coupons: the table only had public "validate" (read active) and
--    "update usage count" policies — there was NO policy letting admins
--    insert/update/delete, so creating a coupon in the admin panel failed
--    with an RLS violation. Mirror the staff-manage pattern used on orders.
-- 2. Contact form: the storefront was inserting into contact_submissions,
--    a table that never existed (errors were swallowed). Create it.
-- 3. Newsletter: "Stay in the Loop" was purely cosmetic. Create the
--    newsletter_subscribers table it now writes to.
-- 4. Reviews: allow logged-in customers to pick a public display name
--    (or stay anonymous) instead of always exposing their account name.

-- ---------------------------------------------------------------------------
-- 1. Coupons: staff management policy
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff manage coupons" ON public.coupons;
CREATE POLICY "Staff manage coupons" ON public.coupons
  FOR ALL
  USING (is_admin_or_staff())
  WITH CHECK (is_admin_or_staff());

-- ---------------------------------------------------------------------------
-- 2. Contact submissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new', -- new | read | replied
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can send a contact message" ON public.contact_submissions;
CREATE POLICY "Anyone can send a contact message" ON public.contact_submissions
  FOR INSERT
  WITH CHECK (
    length(btrim(name)) BETWEEN 1 AND 100
    AND length(btrim(email)) BETWEEN 3 AND 200
    AND length(btrim(subject)) BETWEEN 1 AND 200
    AND length(btrim(message)) BETWEEN 1 AND 5000
  );

DROP POLICY IF EXISTS "Staff manage contact messages" ON public.contact_submissions;
CREATE POLICY "Staff manage contact messages" ON public.contact_submissions
  FOR ALL
  USING (is_admin_or_staff())
  WITH CHECK (is_admin_or_staff());

GRANT INSERT ON public.contact_submissions TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.contact_submissions TO authenticated;
GRANT ALL ON public.contact_submissions TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Newsletter subscribers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'footer', -- footer | signup | checkout
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can subscribe to the newsletter" ON public.newsletter_subscribers;
CREATE POLICY "Anyone can subscribe to the newsletter" ON public.newsletter_subscribers
  FOR INSERT
  WITH CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

DROP POLICY IF EXISTS "Staff manage newsletter subscribers" ON public.newsletter_subscribers;
CREATE POLICY "Staff manage newsletter subscribers" ON public.newsletter_subscribers
  FOR ALL
  USING (is_admin_or_staff())
  WITH CHECK (is_admin_or_staff());

GRANT INSERT ON public.newsletter_subscribers TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.newsletter_subscribers TO authenticated;
GRANT ALL ON public.newsletter_subscribers TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Reviews: optional public display name for signed-in reviewers
-- ---------------------------------------------------------------------------
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS display_name text;
