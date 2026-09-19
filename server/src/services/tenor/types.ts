export type TenorContentFilter = 'off' | 'low' | 'medium' | 'high';

export interface TenorMedia {
  url: string;
  dims: [number, number];
  duration: number;
  size: number;
}

export interface TenorGif {
  id: string;
  title: string;
  contentDescription: string;
  itemUrl: string;
  shareUrl: string;
  created: number;
  tags: string[];
  media: {
    gif: TenorMedia;
    tinygif: TenorMedia;
  };
  raw: Record<string, unknown>;
}

export interface TenorPage {
  gifs: TenorGif[];
  next: string | null;
}

export interface FetchFeaturedOptions {
  limit?: number;
  position?: string;
  contentFilter?: TenorContentFilter;
  country?: string;
  locale?: string;
}
