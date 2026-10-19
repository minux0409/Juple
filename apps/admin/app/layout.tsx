import type { Metadata } from 'next';
import { strings } from '../lib/strings';
import './globals.css';

// An operator tool: never indexed or followed (also X-Robots-Tag in next.config and robots.ts).
export const metadata: Metadata = {
  title: strings.appName,
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
