import { Star } from "lucide-react";

export function StarRating({ value, label = `${value} out of 4 stars` }: { value: number; label?: string }) {
  return (
    <div className="flex items-center gap-0.5" role="img" aria-label={label}>
      {[0, 1, 2, 3].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={`h-3 w-3 ${i < value ? "text-yellow-400" : "text-muted-foreground/30"}`}
          fill={i < value ? "currentColor" : "none"}
        />
      ))}
    </div>
  );
}

export function StarRatingFilter({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">Minimum rating</legend>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4].map((rating) => (
          <label
            key={rating}
            className="cursor-pointer rounded-sm p-1 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
            title={`${rating} star${rating === 1 ? "" : "s"} or higher`}
          >
            <input
              type="radio"
              name="minimum-rating"
              value={rating}
              checked={value === rating}
              onChange={() => onChange(rating)}
              className="sr-only"
              aria-label={`${rating} star${rating === 1 ? "" : "s"} or higher`}
            />
            <Star
              aria-hidden="true"
              className={`h-5 w-5 ${value !== null && rating <= value ? "text-yellow-400" : "text-muted-foreground/30"}`}
              fill={value !== null && rating <= value ? "currentColor" : "none"}
            />
          </label>
        ))}
        {value !== null && (
          <button
            type="button"
            className="ml-1 text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => onChange(null)}
          >
            Clear
          </button>
        )}
      </div>
    </fieldset>
  );
}