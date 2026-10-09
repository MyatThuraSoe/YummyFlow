import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import StarRating from "@/components/menu/StarRating";
import {
  deleteDishReview,
  fetchDishReviews,
  submitDishReview,
  type DishReviews,
  type ReviewRow,
} from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { qk } from "@/lib/query-keys";
import type { itemsProps } from "@/type";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

/**
 * The average and the count.
 *
 * Seeded from the menu payload so the card reads correctly before any review
 * request has been made — the menu list already carries both. Once this
 * dialog's own query resolves it takes over, because that number is computed
 * over the same set the reviews below are drawn from.
 */
const Summary = ({
  item,
  data,
}: {
  item: itemsProps;
  data?: DishReviews;
}) => {
  const average = data?.averageRating ?? item.averageRating ?? 0;
  const total = data?.totalReviews ?? item.totalReviews ?? 0;

  // Zero reviews is not the same as bad reviews, and rendering "0.0" for a
  // dish nobody has tried yet reads as an insult.
  if (total === 0) {
    return (
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <Star size={12} className="fill-transparent" />
        No reviews yet
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <StarRating value={average} size={13} />
      <span className="text-xs font-bold">{average.toFixed(1)}</span>
      <span className="text-xs text-muted-foreground">
        ({total} {total === 1 ? "review" : "reviews"})
      </span>
    </span>
  );
};

const Breakdown = ({ data }: { data: DishReviews }) => {
  const max = Math.max(1, ...data.breakdown.map((b) => b.count));

  return (
    <div className="space-y-1">
      {data.breakdown.map(({ star, count }) => (
        <div key={star} className="flex items-center gap-2 text-xs">
          <span className="w-6 shrink-0 tabular-nums text-muted-foreground flex items-center gap-0.5">
            {star}
            <Star size={9} className="fill-primary text-primary" />
          </span>
          {/* Bars share the row width and are scaled against the busiest
              bucket, not the total — a 5-star-only dish would otherwise render
              five full bars and read as evenly reviewed. */}
          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">
            {count}
          </span>
        </div>
      ))}
    </div>
  );
};

const ReviewCard = ({
  review,
  canDelete,
  onDelete,
  deleting,
}: {
  review: ReviewRow;
  canDelete: boolean;
  onDelete: () => void;
  deleting: boolean;
}) => (
  <div className="flex gap-3 py-3 border-b last:border-0">
    {review.authorImage ? (
      <img
        src={review.authorImage}
        alt=""
        className="size-8 rounded-full object-cover shrink-0"
      />
    ) : (
      <div className="size-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
        {review.author.slice(0, 1).toUpperCase()}
      </div>
    )}
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold">{review.author}</span>
        <StarRating value={review.rating} size={11} />
        <span className="text-[11px] text-muted-foreground ml-auto">
          {new Date(review.createdAt).toLocaleDateString()}
        </span>
      </div>
      {review.comment && (
        <p className="text-sm text-muted-foreground mt-1 break-words">
          {review.comment}
        </p>
      )}
    </div>
    {canDelete && (
      <button
        onClick={onDelete}
        disabled={deleting}
        aria-label="Delete review"
        className="text-muted-foreground hover:text-destructive transition-colors shrink-0 self-start disabled:opacity-50"
      >
        <Trash2 size={14} />
      </button>
    )}
  </div>
);

const ReviewDialog = ({ item }: { item: itemsProps }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");

  // Reset the form when the dialog closes so a half-written review does not
  // greet the next guest to this dish.
  useEffect(() => {
    if (!open) {
      setPage(1);
      setRating(0);
      setComment("");
    }
  }, [open]);

  const { data, isPending, isFetching } = useQuery({
    queryKey: qk.menu.reviews(item.id, page),
    queryFn: () => fetchDishReviews({ menuItemId: item.id, page }),
    enabled: open,
    staleTime: 60_000,
  });

  /**
   * A review changes the dish's average, which lives on the menu payload, but
   * the full menu is a much bigger fetch. Invalidate the reviews (refetched
   * below explicitly) and let the summary fall back to the server's number,
   * which arrives with the reviews themselves.
   */
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.menu.reviews(item.id, 1) });
    await queryClient.invalidateQueries({ queryKey: qk.menu.all });
  };

  const submitMutation = useMutation({
    mutationFn: () =>
      submitDishReview({
        menuItemId: item.id,
        rating,
        comment: comment.trim() || undefined,
      }),
    onSuccess: async () => {
      await invalidate();
      setRating(0);
      setComment("");
      toast.success("Thanks — your review is up.");
    },
    onError: (e: Error) => toast.error(e.message || "Could not save review."),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => deleteDishReview({ id }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Review removed.");
    },
    onError: (e: Error) => toast.error(e.message || "Could not delete review."),
  });

  // The API omits a reviewer's id, so "is this mine?" cannot be answered
  // exactly. Rather than guess and delete the wrong person's review, only
  // management roles get a delete control here — the same gate ItemCard uses.
  const { data: session } = authClient.useSession();
  const isManager =
    session?.user.role === "ADMIN" || session?.user.role === "MANAGER";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-left"
        >
          <Summary item={item} data={data} />
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare size={18} className="text-primary" />
            Reviews for {item.name}
          </DialogTitle>
          <DialogDescription>
            {data && data.totalReviews > 0
              ? `${data.averageRating.toFixed(1)} out of 5 from ${data.totalReviews} ${
                  data.totalReviews === 1 ? "review" : "reviews"
                }.`
              : "Be the first to review this dish."}
          </DialogDescription>
        </DialogHeader>

        {data && data.totalReviews > 0 && (
          <div className="flex gap-6 items-center rounded-lg bg-muted/40 p-4">
            <div className="text-center shrink-0">
              <div className="text-3xl font-black leading-none">
                {data.averageRating.toFixed(1)}
              </div>
              <StarRating value={data.averageRating} size={12} className="mt-1" />
              <div className="text-[11px] text-muted-foreground mt-1">
                {data.totalReviews} total
              </div>
            </div>
            <div className="flex-1">
              <Breakdown data={data} />
            </div>
          </div>
        )}

        {/* The composer sits above the list: the common intent is to leave a
            review, not to scroll through other people's first. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (rating === 0) {
              toast.error("Pick a star rating first.");
              return;
            }
            submitMutation.mutate();
          }}
          className="space-y-3 rounded-lg border p-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">Your rating</span>
            {rating > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {rating} star{rating === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          <StarRating value={rating} onChange={setRating} size={26} />
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What did you think? (optional)"
            rows={2}
            maxLength={1000}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {comment.length}/1000
            </span>
            <Button
              type="submit"
              size="sm"
              disabled={rating === 0 || submitMutation.isPending}
            >
              {submitMutation.isPending && (
                <Loader2 size={14} className="animate-spin" />
              )}
              Submit review
            </Button>
          </div>
        </form>

        <ScrollArea className="max-h-[40vh] w-full">
          {isPending ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-muted-foreground" />
            </div>
          ) : data && data.data.length > 0 ? (
            <div className="flex flex-col">
              {data.data.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  canDelete={isManager}
                  deleting={deleteMutation.isPending}
                  onDelete={() => deleteMutation.mutate({ id: review.id })}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              No reviews yet.
            </p>
          )}
        </ScrollArea>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between text-xs">
            <Button
              variant="outline"
              size="sm"
              disabled={!data.hasPrevPage || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Newer
            </Button>
            <span className="text-muted-foreground tabular-nums">
              Page {data.currentPage} of {data.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!data.hasNextPage || isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Older
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ReviewDialog;
