// "Artifact" + "Verification result" paired panel used on solutions pages.
// See docs/brand/style-guide.md §5 (Scenario blocks).
//
// Both halves render in mono so they read as literal artifacts, not styled
// labels. The 12px uppercase micro labels are the only ornament.

import type { ReactNode } from 'react';

import { MicroLabel } from './Eyebrow';

export interface ScenarioBlockProps {
  artifact: ReactNode;
  result: ReactNode;
  /** Optional paragraph below the artifact/result pair. */
  body?: ReactNode;
  className?: string;
}

export const ScenarioBlock = ({
  artifact,
  result,
  body,
  className,
}: ScenarioBlockProps): React.JSX.Element => (
  <div
    className={`border border-[var(--color-border)] bg-white p-6 ${className ?? ''}`}
  >
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <MicroLabel>Artifact</MicroLabel>
        <div className="mt-2 font-mono text-[14px] leading-6 text-neutral-700">
          {artifact}
        </div>
      </div>
      <div>
        <MicroLabel>Verification result</MicroLabel>
        <div className="mt-2 font-mono text-[14px] leading-6 text-neutral-700">
          {result}
        </div>
      </div>
    </div>
    {body && (
      <p className="mt-6 text-[16px] leading-7 text-neutral-700">{body}</p>
    )}
  </div>
);
