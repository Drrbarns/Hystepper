-- Ensure anonymous clients can read published blog posts (idempotent).
-- Consolidated migration already defines "Public view published posts"; this
-- adds an explicit published-only policy if missing on older deployments.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'blog_posts'
      AND policyname = 'Public read published blog'
  ) THEN
    CREATE POLICY "Public read published blog"
      ON blog_posts
      FOR SELECT
      USING (status = 'published');
  END IF;
END $$;
