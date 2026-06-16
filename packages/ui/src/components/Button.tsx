// Brand buttons. Solid (accent bg, white text) and Link (accent text, no bg).
// See docs/brand/style-guide.md §5 (Buttons). Sharp corners, no shadow.

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type BaseProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

export const Button = ({
  children,
  className,
  ...rest
}: BaseProps): React.JSX.Element => (
  <button
    {...rest}
    className={`inline-flex items-center justify-center bg-[var(--color-accent)] px-5 py-3 text-[15px] font-medium text-white transition-opacity duration-150 disabled:opacity-50 ${className ?? ''}`}
  >
    {children}
  </button>
);

export const LinkButton = ({
  children,
  className,
  ...rest
}: BaseProps): React.JSX.Element => (
  <button
    {...rest}
    className={`inline-flex items-center text-[15px] font-medium text-[var(--color-accent)] underline-offset-2 transition-colors duration-150 hover:underline ${className ?? ''}`}
  >
    {children}
  </button>
);
