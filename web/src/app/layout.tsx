import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import {
  BING_SITE_VERIFICATION,
  GOOGLE_SITE_VERIFICATION,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_URL,
} from '@/lib/config';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

// `metadataBase` lets every page below just say `openGraph.url: '/whatever'` and have Next.js
// resolve it to an absolute URL for og:url/og:image - required for rich previews, since most
// unfurlers (Slack, Facebook, X/Twitter, iMessage) ignore relative values outright.
export const metadata: Metadata = {
  metadataBase: new URL(`${SITE_URL}/`),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  // Baseline `<meta name="keywords">` (L42-434); pages with more specific terms (a category name,
  // a gif title, ...) override this via `buildKeywords()` (`lib/seo.ts`) rather than dropping it.
  keywords: SITE_KEYWORDS,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: {
      default: SITE_NAME,
      template: `%s · ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: {
      default: SITE_NAME,
      template: `%s · ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
  },
  // Search-console ownership verification (L42-435); omitted entirely (Next.js drops the tag)
  // until the corresponding env var is actually set - see lib/config.ts for where to get each
  // code from and why there's nothing to change here once someone does.
  verification: {
    ...(GOOGLE_SITE_VERIFICATION ? { google: GOOGLE_SITE_VERIFICATION } : {}),
    ...(BING_SITE_VERIFICATION ? { other: { 'msvalidate.01': BING_SITE_VERIFICATION } } : {}),
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-screen flex-col font-sans">
        <Header />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
