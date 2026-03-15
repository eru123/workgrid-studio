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

export function ExplorerTreeSkeleton({
  depth = 1,
  rows = 4,
}: {
  depth?: number;
  rows?: number;
}) {
  return (
    <div className="space-y-1 py-1">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={`${depth}-${index}`}
          className="flex items-center gap-2 px-2 py-1.5"
          style={{ paddingLeft: `${depth * 14 + 12}px` }}
        >
          <Skeleton className="h-3.5 w-3.5 rounded-sm shrink-0" />
          <Skeleton
            className={cn(
              "h-3 rounded",
              index % 3 === 0 ? "w-28" : index % 3 === 1 ? "w-36" : "w-24",
            )}
          />
          <Skeleton className="ml-auto h-3 w-8 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function DataGridSkeleton({
  columns = 6,
  rows = 10,
  showRowNumbers = true,
}: {
  columns?: number;
  rows?: number;
  showRowNumbers?: boolean;
}) {
  return (
    <div className="h-full w-full overflow-hidden">
      <div className="border-b bg-muted/30 px-2 py-2">
        <div className="flex items-center gap-2">
          {showRowNumbers && <Skeleton className="h-3.5 w-10 shrink-0 rounded" />}
          {Array.from({ length: columns }).map((_, index) => (
            <Skeleton
              key={`header-${index}`}
              className={cn(
                "h-3.5 rounded",
                index % 4 === 0
                  ? "w-28"
                  : index % 4 === 1
                    ? "w-40"
                    : index % 4 === 2
                      ? "w-24"
                      : "w-32",
              )}
            />
          ))}
        </div>
      </div>
      <div className="divide-y divide-border/40">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={`row-${rowIndex}`} className="flex items-center gap-2 px-2 py-2">
            {showRowNumbers && <Skeleton className="h-3 w-8 shrink-0 rounded" />}
            {Array.from({ length: columns }).map((__, columnIndex) => (
              <Skeleton
                key={`cell-${rowIndex}-${columnIndex}`}
                className={cn(
                  "h-3 rounded",
                  columnIndex % 4 === 0
                    ? "w-20"
                    : columnIndex % 4 === 1
                      ? "w-36"
                      : columnIndex % 4 === 2
                        ? "w-16"
                        : "w-28",
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
