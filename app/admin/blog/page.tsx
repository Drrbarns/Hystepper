'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import AdminTableScroll from '@/components/admin/AdminTableScroll';
import {
  slugifyBlogTitle,
  parseTagsInput,
  formatTagsForInput,
  formatBlogDate,
  type BlogStatus,
} from '@/lib/blog-utils';

type BlogPostRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  featured_image: string | null;
  status: BlogStatus;
  published_at: string | null;
  seo_title: string | null;
  seo_description: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
};

const EMPTY_FORM = {
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  featured_image: '',
  status: 'draft' as BlogStatus,
  seo_title: '',
  seo_description: '',
  tags: '',
};

const statusColors: Record<BlogStatus, string> = {
  published: 'bg-emerald-100 text-emerald-700',
  draft: 'bg-gray-100 text-gray-700',
  archived: 'bg-amber-100 text-amber-800',
};

export default function AdminBlogPage() {
  const [posts, setPosts] = useState<BlogPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | BlogStatus>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingPost, setEditingPost] = useState<BlogPostRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [slugTouched, setSlugTouched] = useState(false);

  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('blog_posts')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setPosts((data as BlogPostRow[]) || []);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load blog posts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPosts();
  }, [fetchPosts]);

  const openCreate = () => {
    setEditingPost(null);
    setForm(EMPTY_FORM);
    setSlugTouched(false);
    setShowModal(true);
  };

  const openEdit = (post: BlogPostRow) => {
    setEditingPost(post);
    setForm({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt || '',
      content: post.content,
      featured_image: post.featured_image || '',
      status: post.status,
      seo_title: post.seo_title || '',
      seo_description: post.seo_description || '',
      tags: formatTagsForInput(post.tags),
    });
    setSlugTouched(true);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingPost(null);
    setForm(EMPTY_FORM);
    setSlugTouched(false);
  };

  const handleTitleChange = (title: string) => {
    setForm((prev) => ({
      ...prev,
      title,
      slug: slugTouched ? prev.slug : slugifyBlogTitle(title),
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) {
      toast.error('Title and content are required');
      return;
    }

    const slug = (form.slug.trim() || slugifyBlogTitle(form.title)).slice(0, 120);
    if (!slug) {
      toast.error('Slug is required');
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload = {
        title: form.title.trim(),
        slug,
        excerpt: form.excerpt.trim() || null,
        content: form.content.trim(),
        featured_image: form.featured_image.trim() || null,
        status: form.status,
        seo_title: form.seo_title.trim() || null,
        seo_description: form.seo_description.trim() || null,
        tags: parseTagsInput(form.tags),
        updated_at: now,
      };

      if (form.status === 'published') {
        const existingPublishedAt = editingPost?.published_at;
        Object.assign(payload, {
          published_at: existingPublishedAt || now,
        });
      }

      if (editingPost) {
        const { error } = await supabase
          .from('blog_posts')
          .update(payload)
          .eq('id', editingPost.id);
        if (error) throw error;
        toast.success('Post updated');
      } else {
        const { error } = await supabase.from('blog_posts').insert({
          ...payload,
          published_at: form.status === 'published' ? now : null,
        });
        if (error) throw error;
        toast.success('Post created');
      }

      closeModal();
      await fetchPosts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error(msg.includes('duplicate') ? 'Slug already exists' : msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (post: BlogPostRow) => {
    if (!confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
    try {
      const { error } = await supabase.from('blog_posts').delete().eq('id', post.id);
      if (error) throw error;
      toast.success('Post deleted');
      await fetchPosts();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete post');
    }
  };

  const filteredPosts =
    statusFilter === 'all' ? posts : posts.filter((p) => p.status === statusFilter);

  const publishedCount = posts.filter((p) => p.status === 'published').length;
  const draftCount = posts.filter((p) => p.status === 'draft').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Blog Posts</h1>
          <p className="text-gray-600 mt-1 text-sm sm:text-base">Create and manage blog content for the storefront</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 sm:px-6 sm:py-3 rounded-lg font-semibold transition-colors whitespace-nowrap self-start sm:self-auto text-sm sm:text-base"
        >
          <i className="ri-add-line mr-2"></i>
          New Post
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Total Posts</p>
          <p className="text-2xl font-bold text-gray-900">{posts.length}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Published</p>
          <p className="text-2xl font-bold text-emerald-700">{publishedCount}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Drafts</p>
          <p className="text-2xl font-bold text-gray-700">{draftCount}</p>
        </div>
        <div className="bg-white rounded-xl border-2 border-gray-200 p-4">
          <p className="text-sm text-gray-600 mb-1">Archived</p>
          <p className="text-2xl font-bold text-amber-700">
            {posts.filter((p) => p.status === 'archived').length}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200 flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | BlogStatus)}
            className="px-4 py-2 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-medium cursor-pointer text-sm"
          >
            <option value="all">All Status</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
          <span className="text-sm text-gray-500 ml-auto">{filteredPosts.length} post(s)</span>
        </div>

        <AdminTableScroll>
          <table className="w-full min-w-[48rem]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Post</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Slug</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Updated</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-500">
                    Loading posts…
                  </td>
                </tr>
              ) : filteredPosts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-500">
                    No posts yet. Create your first article.
                  </td>
                </tr>
              ) : (
                filteredPosts.map((post) => (
                  <tr key={post.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-20 h-14 bg-gray-100 rounded-lg overflow-hidden shrink-0">
                          {post.featured_image ? (
                            <img src={post.featured_image} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                              <i className="ri-image-line text-xl"></i>
                            </div>
                          )}
                        </div>
                        <div>
                          <button
                            type="button"
                            onClick={() => openEdit(post)}
                            className="font-semibold text-gray-900 hover:text-emerald-700 text-left"
                          >
                            {post.title}
                          </button>
                          {post.excerpt && (
                            <p className="text-sm text-gray-500 mt-1 line-clamp-1">{post.excerpt}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-sm font-mono text-gray-600">{post.slug}</td>
                    <td className="py-4 px-4">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold capitalize whitespace-nowrap ${statusColors[post.status]}`}
                      >
                        {post.status}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-600 whitespace-nowrap">
                      {formatBlogDate(post.updated_at)}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => openEdit(post)}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                          aria-label="Edit"
                        >
                          <i className="ri-edit-line text-lg"></i>
                        </button>
                        {post.status === 'published' && (
                          <Link
                            href={`/blog/${post.slug}`}
                            target="_blank"
                            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                            aria-label="View on storefront"
                          >
                            <i className="ri-eye-line text-lg"></i>
                          </Link>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(post)}
                          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                          aria-label="Delete"
                        >
                          <i className="ri-delete-bin-line text-lg"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </AdminTableScroll>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <h2 className="text-2xl font-bold text-gray-900">
                {editingPost ? 'Edit Post' : 'New Post'}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <i className="ri-close-line text-2xl"></i>
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Slug</label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm((prev) => ({ ...prev, slug: e.target.value }));
                  }}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none font-mono text-sm"
                  placeholder="auto-generated-from-title"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Excerpt</label>
                <textarea
                  value={form.excerpt}
                  onChange={(e) => setForm((prev) => ({ ...prev, excerpt: e.target.value }))}
                  rows={2}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Content *</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
                  rows={12}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none font-mono text-sm"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Plain text or HTML supported.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Featured image URL</label>
                <input
                  type="url"
                  value={form.featured_image}
                  onChange={(e) => setForm((prev) => ({ ...prev, featured_image: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="https://…"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, status: e.target.value as BlogStatus }))
                    }
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={form.tags}
                    onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="shopping, tips, ghana"
                  />
                </div>
              </div>

              <div className="border-t border-gray-200 pt-5">
                <h3 className="text-sm font-bold text-gray-800 mb-3">SEO</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">SEO title</label>
                    <input
                      type="text"
                      value={form.seo_title}
                      onChange={(e) => setForm((prev) => ({ ...prev, seo_title: e.target.value }))}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">SEO description</label>
                    <textarea
                      value={form.seo_description}
                      onChange={(e) => setForm((prev) => ({ ...prev, seo_description: e.target.value }))}
                      rows={2}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 border border-gray-300 text-gray-700 font-semibold py-3 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving…' : editingPost ? 'Update Post' : 'Create Post'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
