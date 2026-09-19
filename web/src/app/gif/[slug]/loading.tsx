import { Container } from '@/components/layout/Container';
import { GifCardSkeleton, GridSkeleton, Skeleton } from '@/components/ui/Skeleton';

export default function GifLoading() {
  return (
    <Container className="py-10">
      <Skeleton className="h-4 w-40" />

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="mt-6 h-8 w-2/3" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-1 h-4 w-5/6" />
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        </div>

        <div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-9 w-full" />
        </div>
      </div>

      <div className="mt-12">
        <Skeleton className="h-6 w-48" />
        <div className="mt-4">
          <GridSkeleton count={10} Item={GifCardSkeleton} />
        </div>
      </div>
    </Container>
  );
}
