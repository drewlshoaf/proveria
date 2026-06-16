// Compliance / certification row. Title on the left, mono status text on the
// right, paragraph below. The status uses the accent color only when work is
// actively in progress; otherwise neutral-500. This is the one place the
// accent surfaces for status text — see docs/brand/style-guide.md §5.

import type { ReactNode } from 'react';

export interface ComplianceStatusProps {
  title: ReactNode;
  status: ReactNode;
  inProgress?: boolean;
  children: ReactNode;
  className?: string;
}

export const ComplianceStatus = ({
  title,
  status,
  inProgress = false,
  children,
  className,
}: ComplianceStatusProps): React.JSX.Element => (
  <div
    className={`border-t border-[var(--color-border)] py-6 first:border-t-0 first:pt-0 ${className ?? ''}`}
  >
    <div className="flex flex-col gap-2 md:flex-row md:items-baseline md:justify-between">
      <h3 className="text-[16px] font-medium text-neutral-900">{title}</h3>
      <span
        className={`font-mono text-[14px] ${inProgress ? 'text-[var(--color-accent)]' : 'text-neutral-500'}`}
      >
        {status}
      </span>
    </div>
    <p className="mt-3 max-w-[820px] text-[16px] leading-7 text-neutral-600">
      {children}
    </p>
  </div>
);
