import type { ReactNode } from 'react';

import './globals.css';

export const metadata = {
  title: 'Proveria Verifier',
  description: 'Verify Proveria attestations without uploading source files.',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
