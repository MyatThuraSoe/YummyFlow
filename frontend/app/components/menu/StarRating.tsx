import { Star } from "lucide-react";
import { useState } from "react";

/**
 * Star row, usable as a read-only average or as a rating input.
 *
 * The half star is the whole reason this is a component rather than five
 * `<Star>` calls: a 4.3 average shown as five whole stars either lies
 * (rounding up) or understates the dish (rounding down). The partial fill is
 * clipped from a second absolutely-positioned row, so the same markup serves
 * both the display and the picker.
 */
const StarRating = ({
  value,
  onChange,
  size = 16,
  className = "",
}: {
  /** 0–5. Fractional for display, integer when interactive. */
  value: number;
  onChange?: (next: number) => void;
  size?: number;
  className?: string;
}) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const interactive = typeof onChange === "function";
  // While hovering a picker, the cursor position is the honest answer —
  // not the value the user last committed.
  const shown = interactive && hovered !== null ? hovered : value;

  const row = (filled: boolean) => (
    <div className="flex items-center" style={{ width: size * 5, height: size }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={size}
          strokeWidth={1.5}
          // `fill-primary` is a colour the theme already defines; the amber
          // class would fight dark mode.
          className={
            filled ? "fill-primary text-primary" : "fill-transparent text-muted-foreground/30"
          }
        />
      ))}
    </div>
  );

  if (!interactive) {
    // Read-only: render the empty row, then clip the filled one to `value`/5.
    return (
      <span
        className={`relative inline-block shrink-0 ${className}`}
        aria-label={`Rated ${value.toFixed(1)} out of 5`}
      >
        {row(false)}
        <span
          className="absolute inset-y-0 left-0 overflow-hidden"
          style={{ width: `${(Math.max(0, Math.min(5, value)) / 5) * 100}%` }}
        >
          {row(true)}
        </span>
      </span>
    );
  }

  return (
    <div
      className={`flex items-center gap-1 ${className}`}
      onMouseLeave={() => setHovered(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const active = star <= shown;
        return (
          <button
            key={star}
            type="button"
            // A radio group is the honest semantic: one rating, five choices.
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            onMouseEnter={() => setHovered(star)}
            onClick={() => onChange(star)}
            className="transition-transform active:scale-90 focus-visible:outline-none"
          >
            <Star
              size={size}
              strokeWidth={1.5}
              className={
                active
                  ? "fill-primary text-primary"
                  : "fill-transparent text-muted-foreground/30"
              }
            />
          </button>
        );
      })}
    </div>
  );
};

export default StarRating;
