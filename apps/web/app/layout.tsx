import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import './reference.css';
import './app.css';

const font = Be_Vietnam_Pro({ subsets: ['latin', 'vietnamese'], weight: ['300', '400', '500', '600', '700'], display: 'swap', variable: '--font-app' });

export const metadata: Metadata = { title: 'Competence Lab', description: 'Dây chuyền xây khung năng lực có thể truy vết' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={font.variable}>
      <body>{children}</body>
    </html>
  );
}
