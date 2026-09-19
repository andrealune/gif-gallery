import { Container } from '@/components/layout/Container';
import { GifCardSkeleton, GridSkeleton, Skeleton } from '@/components/ui/Skeleton';

export default function SearchLoading() {
  return (
    <Container className="py-10">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-4 h-11 w-full max-w-xl" />
      <div className="mt-8">
        <GridSkeleton count={10} Item={GifCardSkeleton} />
      </div>
    </Container>
  );
}
