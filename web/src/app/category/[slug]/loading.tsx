import { Container } from '@/components/layout/Container';
import { GifCardSkeleton, GridSkeleton, Skeleton } from '@/components/ui/Skeleton';

export default function CategoryLoading() {
  return (
    <Container className="py-10">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 h-9 w-72" />
      <Skeleton className="mt-2 h-4 w-96" />
      <div className="mt-8">
        <GridSkeleton count={10} Item={GifCardSkeleton} />
      </div>
    </Container>
  );
}
