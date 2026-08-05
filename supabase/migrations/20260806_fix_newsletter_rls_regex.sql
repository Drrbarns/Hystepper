-- Newsletter + contact public inserts were failing in production for two reasons:
-- 1) `[^@\s]` inside a Postgres character class treats `\s` as the letter "s",
--    so any email containing "s" (gmail, etc.) failed WITH CHECK.
-- 2) PostgREST Prefer: return=representation needs a SELECT policy; without one,
--    INSERT…RETURNING is reported as an RLS violation (HTTP 401).
--
-- Storefront now submits via /api/newsletter/subscribe and /api/contact (service
-- DB client). Keep public INSERT policies correct for any direct REST callers.

DROP POLICY IF EXISTS "Anyone can subscribe to the newsletter" ON public.newsletter_subscribers;
DROP POLICY IF EXISTS newsletter_insert_public ON public.newsletter_subscribers;
DROP POLICY IF EXISTS "Staff manage newsletter subscribers" ON public.newsletter_subscribers;

CREATE POLICY "Anyone can subscribe to the newsletter" ON public.newsletter_subscribers
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    AND char_length(btrim(email)) BETWEEN 3 AND 200
  );

CREATE POLICY "Staff manage newsletter subscribers" ON public.newsletter_subscribers
  FOR ALL TO authenticated
  USING (is_admin_or_staff())
  WITH CHECK (is_admin_or_staff());

GRANT INSERT ON public.newsletter_subscribers TO anon, authenticated;

DROP POLICY IF EXISTS "Anyone can send a contact message" ON public.contact_submissions;
DROP POLICY IF EXISTS "Staff manage contact messages" ON public.contact_submissions;

CREATE POLICY "Anyone can send a contact message" ON public.contact_submissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(btrim(name)) BETWEEN 1 AND 100
    AND length(btrim(email)) BETWEEN 3 AND 200
    AND length(btrim(subject)) BETWEEN 1 AND 200
    AND length(btrim(message)) BETWEEN 1 AND 5000
  );

CREATE POLICY "Staff manage contact messages" ON public.contact_submissions
  FOR ALL TO authenticated
  USING (is_admin_or_staff())
  WITH CHECK (is_admin_or_staff());

GRANT INSERT ON public.contact_submissions TO anon, authenticated;
