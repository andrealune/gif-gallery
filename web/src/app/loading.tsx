import { Container } from '@/components/layout/Container';
import { CategoryCardSkeleton, GridSkeleton, Skeleton } from '@/components/ui/Skeleton';

export default function HomeLoading() {
  return (
    <>
      <section className="border-b border-slate-200 bg-gradient-to-b from-brand-50 to-white py-16">
        <Container className="flex flex-col items-center gap-4">
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-11 w-full max-w-xl" />
        </Container>
      </section>
      <Container className="py-10">
        <Skeleton className="h-6 w-48" />
        <div className="mt-6">
          <GridSkeleton count={8} Item={CategoryCardSkeleton} />
        </div>
      </Container>
    </>
  );
}
