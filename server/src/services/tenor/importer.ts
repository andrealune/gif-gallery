import { TenorConfigError } from './errors';
import type { TenorClient } from './client';
import type { TenorGifRepository } from './repository';
import type { FetchFeaturedOptions } from './types';

export interface ImportFeaturedOptions extends Omit<FetchFeaturedOptions, 'position'> {
  pages?: number;
  position?: string;
}

export interface ImportSummary {
  fetched: number;
  inserted: number;
  updated: number;
  next: string | null;
}

export class TenorImporter {
  constructor(
    private readonly client: Pick<TenorClient, 'fetchFeatured'>,
    private readonly repository: Pick<TenorGifRepository, 'store'>
  ) {}

  async importFeatured(options: ImportFeaturedOptions = {}): Promise<ImportSummary> {
    const pages = options.pages ?? 1;
    if (!Number.isInteger(pages) || pages < 1 || pages > 100) {
      throw new TenorConfigError('Tenor import pages must be an integer from 1 to 100');
    }

    const summary: ImportSummary = { fetched: 0, inserted: 0, updated: 0, next: options.position ?? null };
    let position = options.position;
    const seen = new Set<string>();

    for (let pageNumber = 0; pageNumber < pages; pageNumber += 1) {
      const page = await this.client.fetchFeatured({ ...options, position });
      summary.fetched += page.gifs.length;
      for (const gif of page.gifs) {
        if (seen.has(gif.id)) continue;
        seen.add(gif.id);
        const outcome = await this.repository.store(gif);
        summary[outcome] += 1;
      }
      summary.next = page.next;
      if (!page.next) break;
      position = page.next;
    }
    return summary;
  }
}
