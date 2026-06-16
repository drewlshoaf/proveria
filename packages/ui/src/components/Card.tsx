// Bordered, sharp-cornered card. No shadow, no rounding.
// See docs/brand/style-guide.md §5 (Cards).

import type { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  /** "default" inside white sections (no bg), "white" inside off-white sections. */
  variant?: 'default' | 'white';
  /** Padding scale. 'p-8' for content, 'p-6' for compact artifact blocks. */
  padding?: '6' | '8';
  className?: string;
}

export const Card = ({
  children,
  variant = 'default',
  padding = '8',
  className,
}: CardProps): React.JSX.Element => {
  const bg = variant === 'white' ? 'bg-white' : '';
  const pad = padding === '6' ? 'p-4 sm:p-6' : 'p-5 sm:p-8';
  return (
    <div
      className={`border border-[var(--color-border)] ${bg} ${pad} ${className ?? ''}`}
    >
      {children}
    </div>
  );
};
