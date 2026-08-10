'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface Review {
  id: string;
  author: string;
  rating: number;
  date: string;
  verified: boolean;
  content: string;
  helpful: number;
  user_id: string | null;
}

interface ProductReviewsProps {
  productId: string;
}

export default function ProductReviews({ productId }: ProductReviewsProps) {
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState('all');
  // Honour ?review=write (sent in delivered-order SMS / email links) so the
  // customer lands directly on the form instead of having to scroll past
  // existing reviews to find the "Write a Review" button.
  const autoOpenReview = searchParams?.get('review') === 'write';
  const [showReviewForm, setShowReviewForm] = useState(autoOpenReview);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [reviewForm, setReviewForm] = useState({
    // 0 = not chosen yet. Defaulting to 5 made "I didn't click stars" still
    // save as a 5-star review (e.g. anonymous "Bad" with five stars).
    rating: 0,
    content: '',
    guestName: '',
    guestEmail: '',
    displayName: '',
  });
  const [postAnonymously, setPostAnonymously] = useState(false);

  useEffect(() => {
    // Check auth
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      // Prefill the display name with the customer's first name — they can
      // change it or choose to stay anonymous before posting.
      const firstName = session?.user?.user_metadata?.first_name || '';
      if (firstName) {
        setReviewForm(prev => (prev.displayName ? prev : { ...prev, displayName: firstName }));
      }
    });

    fetchReviews();
  }, [productId]);

  // Once the form is mounted (either via auto-open or manual click), scroll
  // it into view. Runs after `loading` flips so the form actually exists.
  useEffect(() => {
    if (!showReviewForm || loading) return;
    // Defer to next frame so the DOM has the form node painted.
    const id = requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [showReviewForm, loading]);

  const fetchReviews = async () => {
    try {
      // Fetch approved reviews
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('product_id', productId)
        .eq('status', 'approved') // Only show approved
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        // Author label preference:
        //   1. display_name chosen by a signed-in reviewer
        //   2. guest_name (reviewer wasn't signed in)
        //   3. "Anonymous" (reviewer chose to stay anonymous, or legacy rows)
        const formattedReviews = data.map((r: any) => ({
          id: r.id,
          author:
            (r.display_name && String(r.display_name).trim()) ||
            (r.guest_name && String(r.guest_name).trim()) ||
            'Anonymous',
          rating: r.rating,
          date: r.created_at,
          verified: r.verified_purchase,
          content: r.content,
          helpful: r.helpful_votes || 0,
          user_id: r.user_id
        }));
        setReviews(formattedReviews);
      }
    } catch (err) {
      console.error('Error fetching reviews:', err);
    } finally {
      setLoading(false);
    }
  };

  const averageRating = reviews.length > 0
    ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length
    : 0;

  const ratingDistribution = [5, 4, 3, 2, 1].map(star => {
    const count = reviews.filter(r => r.rating === star).length;
    return {
      star,
      count,
      percentage: reviews.length > 0 ? (count / reviews.length) * 100 : 0
    };
  });

  const filteredReviews = filter === 'all'
    ? reviews
    : reviews.filter(r => r.rating === parseInt(filter));

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();

    // Guests must give us a name so the review has an author byline —
    // unless they've chosen to post anonymously.
    const guestNameTrimmed = postAnonymously ? 'Anonymous' : reviewForm.guestName.trim();
    if (!user && !guestNameTrimmed) {
      alert('Please tell us your name (or tick "Post anonymously").');
      return;
    }
    if (!reviewForm.rating || reviewForm.rating < 1 || reviewForm.rating > 5) {
      alert('Please tap a star rating before submitting.');
      return;
    }
    if (!reviewForm.content.trim()) {
      alert('Please share a few words about your experience.');
      return;
    }

    setIsSubmitting(true);

    try {
      let isVerifiedPurchase = false;

      if (user) {
        // Authenticated reviewer — verify by user_id on a delivered order.
        const { data: purchaseCheck } = await supabase
          .from('order_items')
          .select('id, orders!inner(user_id, status)')
          .eq('product_id', productId)
          .eq('orders.user_id', user.id)
          .eq('orders.status', 'delivered')
          .limit(1);

        isVerifiedPurchase = !!(purchaseCheck && purchaseCheck.length > 0);
      }

      const insertRow: Record<string, unknown> = {
        product_id: productId,
        rating: reviewForm.rating,
        content: reviewForm.content.trim(),
        status: 'pending',
        verified_purchase: isVerifiedPurchase,
      };

      if (user) {
        insertRow.user_id = user.id;
        insertRow.display_name = postAnonymously
          ? null
          : reviewForm.displayName.trim() || null;
      } else {
        insertRow.user_id = null;
        insertRow.guest_name = guestNameTrimmed;
        const guestEmailTrimmed = reviewForm.guestEmail.trim();
        if (guestEmailTrimmed) insertRow.guest_email = guestEmailTrimmed;
      }

      const { error } = await supabase.from('reviews').insert([insertRow]);

      if (error) throw error;

      alert('Thanks! Your review has been submitted and will appear after a quick check.');
      setShowReviewForm(false);
      setReviewForm({ rating: 0, content: '', guestName: '', guestEmail: '', displayName: '' });
      setPostAnonymously(false);
      fetchReviews();

    } catch (err: any) {
      console.error('Submit review error:', err);
      alert('Failed to submit review: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <div className="py-8 text-center text-gray-500">Loading reviews...</div>;

  return (
    <div className="bg-white rounded-xl shadow-sm p-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Customer Reviews</h2>

      {reviews.length === 0 && !showReviewForm ? (
        <div className="text-center py-8 mb-8 border-b border-gray-200">
          <p className="text-gray-500 mb-4">No reviews yet. Be the first to review!</p>
          <button
            onClick={() => setShowReviewForm(true)}
            className="bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
          >
            Write a Review
          </button>
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-8 mb-8 pb-8 border-b border-gray-200">
            <div className="text-center">
              <div className="text-5xl font-bold text-gray-900 mb-2">{averageRating.toFixed(1)}</div>
              <div className="flex items-center justify-center mb-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <i
                    key={star}
                    className={`ri-star-${star <= Math.round(averageRating) ? 'fill' : 'line'} text-xl ${star <= Math.round(averageRating) ? 'text-yellow-400' : 'text-gray-300'
                      }`}
                  ></i>
                ))}
              </div>
              <p className="text-gray-600">Based on {reviews.length} reviews</p>
            </div>

            <div className="md:col-span-2">
              <div className="space-y-2">
                {ratingDistribution.map((dist) => (
                  <div key={dist.star} className="flex items-center space-x-3">
                    <button
                      onClick={() => setFilter(dist.star.toString())}
                      className="flex items-center space-x-1 hover:text-emerald-700 transition-colors"
                    >
                      <span className="text-sm font-medium w-6">{dist.star}</span>
                      <i className="ri-star-fill text-yellow-400 text-sm"></i>
                    </button>
                    <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-yellow-400 transition-all duration-300"
                        style={{ width: `${dist.percentage}%` }}
                      ></div>
                    </div>
                    <span className="text-sm text-gray-600 w-8">{dist.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${filter === 'all'
                    ? 'bg-emerald-700 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
              >
                All Reviews ({reviews.length})
              </button>
              {/* Simplified filter buttons for brevity */}
            </div>

            {!showReviewForm && (
              <button
                onClick={() => setShowReviewForm(true)}
                className="bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-2 rounded-lg font-semibold transition-colors whitespace-nowrap"
              >
                Write a Review
              </button>
            )}
          </div>
        </>
      )}

      {showReviewForm && (
        <form ref={formRef} onSubmit={handleSubmitReview} className="bg-gray-50 rounded-xl p-6 mb-8 scroll-mt-24">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Write Your Review</h3>

          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-900 mb-2">Your Rating *</label>
            <div className="flex space-x-2" role="radiogroup" aria-label="Star rating">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  role="radio"
                  aria-checked={reviewForm.rating === star}
                  aria-label={`${star} star${star === 1 ? '' : 's'}`}
                  onClick={() => setReviewForm({ ...reviewForm, rating: star })}
                  className="w-10 h-10 flex items-center justify-center"
                >
                  <i
                    className={`ri-star-${star <= reviewForm.rating ? 'fill' : 'line'} text-3xl ${
                      star <= reviewForm.rating ? 'text-yellow-400' : 'text-gray-300'
                    }`}
                  ></i>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              {reviewForm.rating
                ? `${reviewForm.rating} of 5 stars selected`
                : 'Tap a star to rate this product'}
            </p>
          </div>

          {user ? (
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Display Name <span className="text-gray-400 font-normal text-xs">(shown next to your review)</span>
              </label>
              <input
                type="text"
                value={reviewForm.displayName}
                onChange={(e) => setReviewForm({ ...reviewForm, displayName: e.target.value })}
                disabled={postAnonymously}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100 disabled:text-gray-400"
                placeholder="e.g. Linda D."
                maxLength={60}
              />
            </div>
          ) : (
            <>
              <div className="mb-4 grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Your Name {postAnonymously ? '' : '*'}
                  </label>
                  <input
                    type="text"
                    value={reviewForm.guestName}
                    onChange={(e) => setReviewForm({ ...reviewForm, guestName: e.target.value })}
                    disabled={postAnonymously}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100 disabled:text-gray-400"
                    placeholder="e.g. Linda D."
                    maxLength={60}
                    required={!postAnonymously}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Email <span className="text-gray-400 font-normal text-xs">(optional)</span>
                  </label>
                  <input
                    type="email"
                    value={reviewForm.guestEmail}
                    onChange={(e) => setReviewForm({ ...reviewForm, guestEmail: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    placeholder="you@example.com"
                  />
                </div>
              </div>
              <p className="mb-4 text-xs text-gray-500">
                We won&apos;t publish your email — it just helps us follow up if there&apos;s an issue.
              </p>
            </>
          )}

          <label className="mb-4 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={postAnonymously}
              onChange={(e) => setPostAnonymously(e.target.checked)}
              className="w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500"
            />
            <span className="text-sm text-gray-700">
              Post anonymously — your review will show as <span className="font-semibold">“Anonymous”</span>
            </span>
          </label>

          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-900 mb-2">Your Review *</label>
            <textarea
              value={reviewForm.content}
              onChange={(e) => setReviewForm({ ...reviewForm, content: e.target.value })}
              rows={4}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              placeholder="Share your experience with this product"
              maxLength={2000}
              required
            ></textarea>
          </div>

          <div className="flex space-x-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Review'}
            </button>
            <button
              type="button"
              onClick={() => setShowReviewForm(false)}
              className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-3 rounded-lg font-semibold transition-colors whitespace-nowrap"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-6">
        {filteredReviews.map((review) => (
          <div key={review.id} className="pb-6 border-b border-gray-200 last:border-0">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 flex items-center justify-center bg-emerald-100 rounded-full text-emerald-700 font-bold text-lg">
                  {review.author.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-gray-900">{review.author}</span>
                    {review.verified && (
                      <span className="flex items-center text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                        <i className="ri-checkbox-circle-fill mr-1"></i>
                        Verified Must Have
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{new Date(review.date).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="flex items-center space-x-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <i
                    key={star}
                    className={`ri-star-${star <= review.rating ? 'fill' : 'line'} text-lg ${star <= review.rating ? 'text-yellow-400' : 'text-gray-300'
                      }`}
                  ></i>
                ))}
              </div>
            </div>

            <p className="text-gray-700 mb-4">{review.content}</p>

            <div className="flex items-center space-x-4 text-sm">
              <button className="flex items-center space-x-1 text-gray-600 hover:text-emerald-700 transition-colors">
                <i className="ri-thumb-up-line"></i>
                <span>Helpful ({review.helpful})</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
