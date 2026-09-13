import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'SCOPE · Signal capture',
  description: 'A local instrument for deterministic signal acquisition.',
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
