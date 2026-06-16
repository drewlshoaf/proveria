// Mono content block. Off-white bg, 1px border, no rounding.
// Use for fingerprints, IDs, manifest excerpts, CLI output.
// See docs/brand/style-guide.md §5 (Code blocks).

import type { ReactNode } from 'react';

export interface CodeBlockProps {
  children: ReactNode;
  className?: string;
}

export const CodeBlock = ({
  children,
  className,
}: CodeBlockProps): React.JSX.Element => (
  <pre
    className={`overflow-x-auto whitespace-pre border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4 font-mono text-[14px] leading-6 text-neutral-700 ${className ?? ''}`}
  >
    {children}
  </pre>
);

/** Inline mono span for short artifact strings (device id, hash, etc). */
export const Mono = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element => (
  <span
    className={`break-all font-mono text-[14px] text-neutral-700 ${className ?? ''}`}
  >
    {children}
  </span>
);
