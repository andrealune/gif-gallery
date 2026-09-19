import { Container } from './Container';
import { SITE_NAME } from '@/lib/config';

export function Footer() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white">
      <Container className="flex flex-col gap-2 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p>
          &copy; {new Date().getFullYear()} {SITE_NAME}. All GIFs remain the property of their
          respective owners.
        </p>
        <p className="text-slate-400">Built with Next.js &amp; Tailwind CSS.</p>
      </Container>
    </footer>
  );
}
