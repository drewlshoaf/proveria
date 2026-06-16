// Max-width centered container. Brand: 1100px / px-6 on small screens.
// See docs/brand/style-guide.md §4 (Layout).

import type { ReactNode } from 'react';

export interface ContainerProps {
  children: ReactNode;
  className?: string;
}

export const Container = ({ children, className }: ContainerProps): React.JSX.Element => (
  <div className={`mx-auto w-full max-w-[1100px] px-4 sm:px-6 ${className ?? ''}`}>
    {children}
  </div>
);
