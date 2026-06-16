// Status indicator. Mono content, accent when "in progress", neutral-500 otherwise.
// This is the only place the accent appears for status, per brand guide §5
// (Compliance status). No status colors (no red/green/amber).

import type { ReactNode } from 'react';

export type StatusKind = 'in_progress' | 'done' | 'failed' | 'neutral';

export interface StatusBadgeProps {
  kind: StatusKind;
  children: ReactNode;
}

const colorForKind = (kind: StatusKind): string => {
  switch (kind) {
    case 'in_progress':
      return 'text-[var(--color-accent)]';
    case 'failed':
      // Brand: no status colors; failed reads as "negative-emphasis ink-strong".
      return 'text-neutral-900 font-medium';
    case 'done':
    case 'neutral':
    default:
      return 'text-neutral-500';
  }
};

export const StatusBadge = ({
  kind,
  children,
}: StatusBadgeProps): React.JSX.Element => (
  <span className={`font-mono text-[14px] ${colorForKind(kind)}`}>
    {children}
  </span>
);

/** Map an attestation lifecycle state to a status kind for visual emphasis. */
export const attestationStateKind = (state: string): StatusKind => {
  if (state === 'confirmed' || state === 'validated') return 'done';
  if (state === 'failed_needs_review' || state === 'failed') return 'failed';
  if (
    state === 'pending' ||
    state === 'uploaded' ||
    state === 'validating' ||
    state === 'queued_for_publication' ||
    state === 'publishing' ||
    state === 'confirming'
  ) {
    return 'in_progress';
  }
  return 'neutral';
};
