import type { Metadata } from 'next';
import './globals.css';

// Blanket noindex for the whole Public Web Viewer - it has nothing worth indexing (per-page
// metadata below reinforces this, and robots.ts disallows crawling entirely), and a shared
// Collection is not meant to be discoverable by search engines, only by whoever has the link.
export const metadata: Metadata = {
  title: 'Juple',
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
