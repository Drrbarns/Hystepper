'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import AdminTableScroll from '@/components/admin/AdminTableScroll';

export default function AdminReviewsPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedReviews, setSelectedReviews] = useState<string[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      // NOTE: reviews.user_id has its FK on auth.users(id), not public.profiles(id),
      // so PostgREST can't auto-embed `profiles:user_id (...)`. We fetch the
      // profiles in a second round-trip and merge in JS.
      const { data, error } = await supabase
        .from('reviews')
        .select(`
          *,
          products:product_id (name, product_images (url))
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Error fetching reviews:', error);
        return;
      }

      const reviewRows = data || [];
      const userIds = Array.from(
        new Set(reviewRows.map((r: any) => r.user_id).filter(Boolean) as string[])
      );

      let profilesById: Record<string, { full_name?: string | null; email?: string | null }> = {};
      if (userIds.length > 0) {
        const { data: profileRows, error: profileErr } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', userIds);
        if (profileErr) {
          console.warn('Error fetching reviewer profiles:', profileErr);
        } else if (profileRows) {
          profilesById = Object.fromEntries(
            profileRows.map((p: any) => [p.id, { full_name: p.full_name, email: p.email }])
          );
        }
      }

      const formatted = reviewRows.map((r: any) => {
        const profile = r.user_id ? profilesById[r.user_id] : undefined;
        const isGuest = !r.user_id;
        const displayName =
          profile?.full_name ||
          r.guest_name ||
          (isGuest ? 'Guest reviewer' : 'Anonymous');
        const displayEmail = profile?.email || r.guest_email || 'N/A';
        return {
          id: r.id,
          customer: {
            name: displayName,
            email: displayEmail,
            avatar: getInitials(displayName),
            isGuest,
          },
          product: {
            name: r.products?.name || 'Unknown Product',
            image: r.products?.product_images?.[0]?.url || '/placeholder-product.png'
          },
          rating: r.rating,
          comment: r.content,
          date: new Date(r.created_at).toLocaleDateString(),
          status: r.status || 'pending',
          helpful: r.helpful_votes || 0
        };
      });
      setReviews(formatted);
    } catch (error) {
      console.error('Error fetching reviews:', error);
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name: string) => {
    if (!name) return '??';
    return name
      .replace(/[^a-zA-Z ]/g, '')
      .split(' ')
      .map(n => n?.[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '??';
  };

  const filteredReviews = reviews.filter(r =>
    statusFilter === 'all' || r.status.toLowerCase() === statusFilter
  );

  const stats = {
    total: reviews.length,
    pending: reviews.filter(r => r.status.toLowerCase() === 'pending').length,
    approved: reviews.filter(r => r.status.toLowerCase() === 'approved').length,
    rejected: reviews.filter(r => r.status.toLowerCase() === 'rejected').length
  };

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-red-100 text-red-700'
  };

  const statusLabels: Record<string, string> = {
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected'
  };

  const handleSelectAll = () => {
    if (selectedReviews.length === filteredReviews.length) {
      setSelectedReviews([]);
    } else {
      setSelectedReviews(filteredReviews.map(r => r.id));
    }
  };

  const handleSelectReview = (reviewId: string) => {
    if (selectedReviews.includes(reviewId)) {
      setSelectedReviews(selectedReviews.filter(id => id !== reviewId));
    } else {
      setSelectedReviews([...selectedReviews, reviewId]);
    }
  };

  const updateReviewStatus = async (ids: string[], newStatus: 'approved' | 'rejected' | 'pending') => {
    if (ids.length === 0) return;
    try {
      const { error } = await supabase
        .from('reviews')
        .update({ status: newStatus })
        .in('id', ids);
      if (error) throw error;
      fetchReviews();
      setSelectedReviews((prev) => prev.filter((id) => !ids.includes(id)));
    } catch (err: any) {
      console.error('Error updating reviews', err);
      alert('Failed to update reviews: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleBulkAction = async (action: string) => {
    if (selectedReviews.length === 0) return;
    if (action === 'Approve') return updateReviewStatus(selectedReviews, 'approved');
    if (action === 'Reject') return updateReviewStatus(selectedReviews, 'rejected');
  };

  const handleDeleteReview = async (id: string) => {
    if (!confirm('Delete this review permanently? This cannot be undone.')) return;
    try {
      const { error } = await supabase.from('reviews').delete().eq('id', id);
      if (error) throw error;
      fetchReviews();
    } catch (err: any) {
      console.error('Error deleting review', err);
      alert('Failed to delete review: ' + (err?.message || 'Unknown error'));
    }
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center space-x-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <i
            key={star}
            className={`${star <= rating ? 'ri-star-fill text-amber-500' : 'ri-star-line text-gray-300'} text-lg`}
          ></i>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Reviews</h1>
          <p className="text-gray-600 mt-1 text-sm sm:text-base">Moderate and manage customer reviews</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <button
          onClick={() => setStatusFilter('all')}
          className={`p-4 rounded-xl border-2 transition-all text-left ${statusFilter === 'all' ? 'border-emerald-700 bg-emerald-50' : 'border-gray-200 bg-white'
            }`}
        >
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          <p className="text-sm text-gray-600 mt-1">Total Reviews</p>
        </button>
        <button
          onClick={() => setStatusFilter('pending')}
          className={`p-4 rounded-xl border-2 transition-all text-left ${statusFilter === 'pending' ? 'border-amber-700 bg-amber-50' : 'border-gray-200 bg-white'
            }`}
        >
          <p className="text-2xl font-bold text-amber-700">{stats.pending}</p>
          <p className="text-sm text-gray-600 mt-1">Pending Review</p>
        </button>
        <button
          onClick={() => setStatusFilter('approved')}
          className={`p-4 rounded-xl border-2 transition-all text-left ${statusFilter === 'approved' ? 'border-emerald-700 bg-emerald-50' : 'border-gray-200 bg-white'
            }`}
        >
          <p className="text-2xl font-bold text-emerald-700">{stats.approved}</p>
          <p className="text-sm text-gray-600 mt-1">Approved</p>
        </button>
        <button
          onClick={() => setStatusFilter('rejected')}
          className={`p-4 rounded-xl border-2 transition-all text-left ${statusFilter === 'rejected' ? 'border-red-700 bg-red-50' : 'border-gray-200 bg-white'
            }`}
        >
          <p className="text-2xl font-bold text-red-700">{stats.rejected}</p>
          <p className="text-sm text-gray-600 mt-1">Rejected</p>
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 text-transform capitalize">
              {statusFilter === 'all' ? 'All Reviews' : `${statusFilter} Reviews`}
            </h2>
            <select className="px-4 py-2 pr-8 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-medium cursor-pointer">
              <option>Sort by Date</option>
              <option>Sort by Rating</option>
              <option>Sort by Helpful</option>
            </select>
          </div>
        </div>

        {selectedReviews.length > 0 && (
          <div className="p-4 bg-emerald-50 border-b border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-emerald-800 font-semibold text-sm">
              {selectedReviews.length} review{selectedReviews.length > 1 ? 's' : ''} selected
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleBulkAction('Approve')}
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <i className="ri-check-line mr-1"></i>
                Approve
              </button>
              <button
                onClick={() => handleBulkAction('Reject')}
                className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <i className="ri-close-line mr-1"></i>
                Reject
              </button>
            </div>
          </div>
        )}

        <AdminTableScroll>
          <table className="w-full min-w-[42rem]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="py-4 px-6">
                  <input
                    type="checkbox"
                    checked={selectedReviews.length === filteredReviews.length && filteredReviews.length > 0}
                    onChange={handleSelectAll}
                    className="w-4 h-4 text-emerald-700 border-gray-300 rounded focus:ring-emerald-500 cursor-pointer"
                  />
                </th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 w-1/4">Product</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 w-1/4">Customer</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700 w-1/3">Review</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Date</th>
                <th className="text-left py-4 px-4 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-right py-4 px-4 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">Loading reviews...</td></tr>
              ) : filteredReviews.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">No reviews found in this category.</td></tr>
              ) : (
                filteredReviews.map((review) => (
                  <tr key={review.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <input
                        type="checkbox"
                        checked={selectedReviews.includes(review.id)}
                        onChange={() => handleSelectReview(review.id)}
                        className="w-4 h-4 text-emerald-700 border-gray-300 rounded focus:ring-emerald-500 cursor-pointer"
                      />
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <img
                          src={review.product.image}
                          alt={review.product.name}
                          className="w-12 h-12 rounded-lg object-cover border border-gray-100"
                        />
                        <span className="text-sm font-medium text-gray-900 line-clamp-2">{review.product.name}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 flex items-center justify-center bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">
                          {review.customer.avatar}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{review.customer.name}</p>
                          <p className="text-xs text-gray-500">{review.customer.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="space-y-1">
                        {renderStars(review.rating)}
                        <p className="text-sm text-gray-600 line-clamp-3">{review.comment}</p>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-600 whitespace-nowrap">{review.date}</td>
                    <td className="py-4 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${statusColors[String(review.status).toLowerCase()] || 'bg-gray-100'}`}>
                        {statusLabels[String(review.status).toLowerCase()] || review.status}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                        {String(review.status).toLowerCase() !== 'approved' && (
                          <button
                            onClick={() => updateReviewStatus([review.id], 'approved')}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                            title="Approve review"
                          >
                            <i className="ri-check-line mr-1"></i>Approve
                          </button>
                        )}
                        {String(review.status).toLowerCase() !== 'rejected' && (
                          <button
                            onClick={() => updateReviewStatus([review.id], 'rejected')}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                            title="Reject review"
                          >
                            <i className="ri-close-line mr-1"></i>Reject
                          </button>
                        )}
                        {String(review.status).toLowerCase() !== 'pending' && (
                          <button
                            onClick={() => updateReviewStatus([review.id], 'pending')}
                            className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                            title="Move back to pending"
                          >
                            <i className="ri-refresh-line mr-1"></i>Pending
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteReview(review.id)}
                          className="px-2 py-1.5 text-gray-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                          title="Delete review"
                          aria-label="Delete review"
                        >
                          <i className="ri-delete-bin-line text-base"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </AdminTableScroll>

        <div className="p-6 border-t border-gray-200">
          <p className="text-gray-600 text-sm">Showing {filteredReviews.length} reviews</p>
        </div>
      </div>
    </div>
  );
}
