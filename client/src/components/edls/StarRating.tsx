import { Star } from "lucide-react";

export function StarRating({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[0, 1, 2, 3].map((i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${i < value ? "text-yellow-400" : "text-muted-foreground/30"}`}
          fill={i < value ? "currentColor" : "none"}
        />
      ))}
    </div>
  );
}