import type { ReactNode } from 'react';
import './globals.css';
import { RuntimeBanner } from './runtime-banner';

export const metadata = {
  title: 'SCOPE · Signal capture',
  description: 'An instrument for deterministic signal acquisition.',
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RuntimeBanner />
        {children}
      </body>
    </html>
  );
}
