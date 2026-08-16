import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import type { Metadata } from 'next';
import { formatBlogDate } from '@/lib/blog-utils';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://hystepper.vercel.app';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function getPostByParam(param: string) {
  const supabase = getSupabase();
  const isUUID = UUID_RE.test(param);

  let query = supabase
    .from('blog_posts')
    .select('id, title, slug, excerpt, content, featured_image, published_at, seo_title, seo_description, tags, status')
    .eq('status', 'published');

  if (isUUID) {
    query = query.or(`id.eq.${param},slug.eq.${param}`);
  } else {
    query = query.eq('slug', param);
  }

  const { data } = await query.maybeSingle();
  return data;
}

async function getRelatedPosts(excludeId: string, limit = 2) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('blog_posts')
    .select('id, title, slug, featured_image, excerpt')
    .eq('status', 'published')
    .neq('id', excludeId)
    .order('published_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const post = await getPostByParam(id);

  if (!post) {
    return { title: 'Article Not Found | Hy_stepper' };
  }

  const title = post.seo_title?.trim() || post.title;
  const description =
    post.seo_description?.trim() ||
    post.excerpt?.trim() ||
    `Read ${post.title} on the Hy_stepper blog.`;
  const canonicalUrl = `${SITE_URL}/blog/${post.slug}`;
  const image = post.featured_image || `${SITE_URL}/og-share.png?v=20260813b`;

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description,
      type: 'article',
      url: canonicalUrl,
      siteName: 'Hy_stepper',
      locale: 'en_GH',
      images: [{ url: image, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getPostByParam(id);

  if (!post) notFound();

  const relatedPosts = await getRelatedPosts(post.id);
  const contentLooksLikeHtml = /<[a-z][\s\S]*>/i.test(post.content);

  return (
    <div className="min-h-screen bg-white">
      <div className="relative h-96 bg-gray-900">
        {post.featured_image ? (
          <Image
            src={post.featured_image}
            alt={post.title}
            fill
            sizes="100vw"
            className="object-cover opacity-50"
            priority
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-900 to-gray-900 opacity-80" />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-6">{post.title}</h1>
            <div className="flex items-center justify-center gap-6 text-emerald-100 flex-wrap">
              {post.published_at && (
                <span className="flex items-center gap-2">
                  <i className="ri-calendar-line"></i>
                  {formatBlogDate(post.published_at)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {post.excerpt && (
          <p className="text-xl text-gray-600 leading-relaxed mb-10 border-l-4 border-emerald-600 pl-6">
            {post.excerpt}
          </p>
        )}

        <article className="prose prose-lg max-w-none">
          {contentLooksLikeHtml ? (
            <div
              className="text-gray-600 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: post.content }}
              style={{ fontSize: '1.125rem', lineHeight: '1.8' }}
            />
          ) : (
            <div className="text-gray-600 leading-relaxed whitespace-pre-wrap" style={{ fontSize: '1.125rem', lineHeight: '1.8' }}>
              {post.content}
            </div>
          )}
        </article>

        {post.tags && post.tags.length > 0 && (
          <div className="mt-10 flex flex-wrap gap-2">
            {post.tags.map((tag: string) => (
              <span
                key={tag}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-full text-sm"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {relatedPosts.length > 0 && (
          <div className="mt-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-8">Related Articles</h2>
            <div className="grid md:grid-cols-2 gap-8">
              {relatedPosts.map((related) => (
                <Link
                  key={related.id}
                  href={`/blog/${related.slug}`}
                  className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-lg transition-all cursor-pointer"
                >
                  <div className="relative h-48 bg-gray-100">
                    {related.featured_image ? (
                      <Image
                        src={related.featured_image}
                        alt={related.title}
                        fill
                        sizes="(max-width: 768px) 100vw, 50vw"
                        className="object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                        <i className="ri-image-line text-3xl"></i>
                      </div>
                    )}
                  </div>
                  <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-900 leading-tight">{related.title}</h3>
                    {related.excerpt && (
                      <p className="text-sm text-gray-600 mt-2 line-clamp-2">{related.excerpt}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-12 text-center">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-emerald-700 font-medium hover:gap-3 transition-all"
          >
            <i className="ri-arrow-left-line"></i>
            Back to Blog
          </Link>
        </div>
      </div>
    </div>
  );
}
