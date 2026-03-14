import { cn } from "@/lib/utils/cn";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-muted/50",
        className,
      )}
    />
  );
}

export function ProfileListSkeleton() {
  return (
    <div className="p-2 space-y-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-2 rounded border bg-card/50">
          <Skeleton className="w-6 h-6 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-2.5 w-3/4 rounded" />
            <Skeleton className="h-2 w-1/2 rounded" />
          </div>
          <Skeleton className="w-2 h-2 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}
