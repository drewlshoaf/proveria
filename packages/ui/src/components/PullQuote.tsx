// Left-bordered pull quote. Accent-colored rule, mono-soft ink.
// See docs/brand/style-guide.md §5 (Pull quotes). One per page at most.

import type { ReactNode } from 'react';

export const PullQuote = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element => (
  <blockquote
    className={`border-l-2 border-[var(--color-accent)] pl-6 text-[20px] leading-[1.5] text-neutral-700 ${className ?? ''}`}
  >
    {children}
  </blockquote>
);
