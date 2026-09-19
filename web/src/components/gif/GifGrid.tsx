import type { GifSummary } from '@/lib/types';
import { GifCard } from './GifCard';

export function GifGrid({ gifs }: { gifs: GifSummary[] }) {
  return (
    <ul role="list" className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {gifs.map((gif) => (
        <li key={gif.id}>
          <GifCard gif={gif} />
        </li>
      ))}
    </ul>
  );
}
