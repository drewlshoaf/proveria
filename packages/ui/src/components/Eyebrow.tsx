// 14px neutral-500 label above an H2. Sentence case. The only thing that
// sits above a section heading. See docs/brand/style-guide.md §5 (Eyebrow).

import type { ReactNode } from 'react';

export const Eyebrow = ({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element => (
  <p className="text-[14px] text-neutral-500">{children}</p>
);

/** All-caps micro label, 12px wide-tracked. e.g. "ARTIFACT", "STATUS". */
export const MicroLabel = ({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element => (
  <span className="text-[12px] font-medium uppercase tracking-[0.05em] text-neutral-500">
    {children}
  </span>
);
