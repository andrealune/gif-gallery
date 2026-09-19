/** Animated placeholder block used while grids/cards are loading (see app/**\/loading.tsx). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200 ${className}`} aria-hidden="true" />;
}

export function GifCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <Skeleton className="aspect-square w-full" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function CategoryCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <Skeleton className="aspect-[4/3] w-full" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export function GridSkeleton({
  count,
  Item,
}: {
  count: number;
  Item: () => React.ReactElement;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: count }, (_, index) => (
        <Item key={index} />
      ))}
    </div>
  );
}
