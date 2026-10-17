import type { Metadata } from 'next';
import { getDictionary } from '../lib/i18n';
import { THEME_BOOTSTRAP_SCRIPT, THEME_COLOR } from '../lib/theme';
import { ThemeProvider } from './_components/ThemeProvider';
import { SITE_SHARE_IMAGE, SITE_URL } from '../lib/siteMetadata';
import './globals.css';

const siteDescription = getDictionary('en').landingDescription;

// Blanket noindex for the whole Public Web Viewer - it has nothing worth indexing (per-page
// metadata below reinforces this, and robots.ts disallows crawling entirely), and a shared
// Collection is not meant to be discoverable by search engines, only by whoever has the link.
// The link preview defaults to the Juple name, description and app icon (lib/siteMetadata.ts); a shared Collection's page replaces
// openGraph / twitter entirely with its own image-less preview (lib/shareView.ts), and the landing page adds its canonical address.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Juple',
  description: siteDescription,
  openGraph: { title: 'Juple', description: siteDescription, siteName: 'Juple', type: 'website', images: [SITE_SHARE_IMAGE] },
  twitter: { card: 'summary', title: 'Juple', description: siteDescription, images: [SITE_SHARE_IMAGE.url] },
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by the inline script below before first paint (and updated by ThemeProvider), so the attribute legitimately
    // differs from the server markup.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta content={THEME_COLOR.light} name="theme-color" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
