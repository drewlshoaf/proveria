// Sticky top header. Brand: h-14, 1px bottom border, wordmark in accent.
// See docs/brand/style-guide.md §4 (Layout → Header).

import type { ReactNode } from 'react';

export interface HeaderProps {
  /** Right-hand side: user info, sign-out, nav links, etc. */
  right?: ReactNode;
  /** href the wordmark links to (default '/'). */
  homeHref?: string;
}

export const Header = ({
  right,
  homeHref = '/',
}: HeaderProps): React.JSX.Element => (
  <header className="sticky top-0 z-10 min-h-14 border-b border-[var(--color-border)] bg-white">
    <div className="mx-auto flex min-h-14 max-w-[1100px] items-center justify-between gap-4 px-4 py-2 sm:px-6">
      <a
        href={homeHref}
        className="shrink-0 text-[18px] font-medium text-[var(--color-accent)]"
      >
        Proveria
      </a>
      {right && (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1 text-right text-[14px] text-neutral-700 sm:gap-x-7">
          {right}
        </div>
      )}
    </div>
  </header>
);
