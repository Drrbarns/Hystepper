import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@supabase/supabase-js';
import { formatBlogDate } from '@/lib/blog-utils';

export const dynamic = 'force-dynamic';

async function getPublishedPosts() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data } = await supabase
    .from('blog_posts')
    .select('id, title, slug, excerpt, featured_image, published_at, tags')
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false });

  return data || [];
}

export default async function BlogPage() {
  const posts = await getPublishedPosts();
  const featuredPost = posts[0] || null;
  const restPosts = posts.slice(1);

  const allTags = [...new Set(posts.flatMap((p) => p.tags || []))].slice(0, 12);

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-gradient-to-br from-emerald-50 via-white to-amber-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-5xl font-bold text-gray-900 mb-6">Our Blog</h1>
            <p className="text-xl text-gray-600 leading-relaxed">
              Shopping tips, product guides, and the latest trends to help you make smarter purchasing decisions.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {posts.length === 0 ? (
          <div className="text-center py-20 bg-gray-50 rounded-2xl">
            <i className="ri-article-line text-5xl text-gray-300 mb-4"></i>
            <p className="text-xl text-gray-500">No articles published yet. Check back soon.</p>
          </div>
        ) : (
          <>
            {featuredPost && (
              <Link
                href={`/blog/${featuredPost.slug}`}
                className="block mb-16 hover:opacity-90 transition-opacity cursor-pointer"
              >
                <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-lg hover:shadow-2xl transition-shadow">
                  <div className="grid md:grid-cols-2 gap-0">
                    <div className="relative h-96 md:h-auto min-h-[16rem] bg-gray-100">
                      {featuredPost.featured_image ? (
                        <Image
                          src={featuredPost.featured_image}
                          alt={featuredPost.title}
                          fill
                          sizes="(max-width: 768px) 100vw, 50vw"
                          className="object-cover"
                          priority
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                          <i className="ri-image-line text-6xl"></i>
                        </div>
                      )}
                      <div className="absolute top-6 left-6">
                        <span className="bg-emerald-700 text-white px-4 py-2 rounded-full text-sm font-medium">
                          Featured
                        </span>
                      </div>
                    </div>
                    <div className="p-12 flex flex-col justify-center">
                      <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                        {featuredPost.published_at && (
                          <span>{formatBlogDate(featuredPost.published_at)}</span>
                        )}
                      </div>
                      <h2 className="text-4xl font-bold text-gray-900 mb-4 leading-tight">
                        {featuredPost.title}
                      </h2>
                      {featuredPost.excerpt && (
                        <p className="text-gray-600 text-lg leading-relaxed mb-6">{featuredPost.excerpt}</p>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            )}

            <div className="grid lg:grid-cols-4 gap-8">
              <div className="lg:col-span-3">
                {restPosts.length > 0 && (
                  <>
                    <h2 className="text-3xl font-bold text-gray-900 mb-8">Latest Articles</h2>
                    <div className="grid md:grid-cols-2 gap-8">
                      {restPosts.map((post) => (
                        <Link
                          key={post.id}
                          href={`/blog/${post.slug}`}
                          className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-lg transition-all cursor-pointer"
                        >
                          <div className="relative h-64 bg-gray-100">
                            {post.featured_image ? (
                              <Image
                                src={post.featured_image}
                                alt={post.title}
                                fill
                                sizes="(max-width: 768px) 100vw, 50vw"
                                className="object-cover"
                              />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                                <i className="ri-image-line text-4xl"></i>
                              </div>
                            )}
                          </div>
                          <div className="p-6">
                            {post.published_at && (
                              <p className="text-xs text-gray-500 mb-3">{formatBlogDate(post.published_at)}</p>
                            )}
                            <h3 className="text-xl font-bold text-gray-900 mb-3 leading-tight">{post.title}</h3>
                            {post.excerpt && (
                              <p className="text-gray-600 mb-4 leading-relaxed text-sm line-clamp-3">
                                {post.excerpt}
                              </p>
                            )}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {allTags.length > 0 && (
                <div>
                  <div className="bg-gray-50 rounded-2xl p-6 sticky top-24">
                    <h3 className="text-xl font-bold text-gray-900 mb-6">Popular Tags</h3>
                    <div className="flex flex-wrap gap-2">
                      {allTags.map((tag) => (
                        <span
                          key={tag}
                          className="px-4 py-2 bg-white border border-gray-200 rounded-full text-sm text-gray-700 whitespace-nowrap"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-bold text-white mb-4">Ready to Start Shopping?</h2>
          <p className="text-xl text-emerald-100 mb-8 leading-relaxed">
            Browse our curated collection of premium products
          </p>
          <Link
            href="/shop"
            className="inline-flex items-center gap-2 bg-white text-emerald-700 px-8 py-4 rounded-full font-medium hover:bg-emerald-50 transition-colors whitespace-nowrap"
          >
            Explore Products
            <i className="ri-arrow-right-line"></i>
          </Link>
        </div>
      </div>
    </div>
  );
}
