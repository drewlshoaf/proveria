// Form input. Brand: h-11, 1px border-input, focus to border-focus.
// See docs/brand/style-guide.md §5 (Forms).

import type { InputHTMLAttributes, ReactNode } from 'react';

export interface FieldProps {
  label: ReactNode;
  required?: boolean;
  htmlFor: string;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export const Field = ({
  label,
  required,
  htmlFor,
  children,
  hint,
  error,
}: FieldProps): React.JSX.Element => (
  <div className="mb-4">
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-[14px] text-neutral-800"
    >
      {label}
      {required ? ' *' : ''}
    </label>
    {children}
    {hint && !error && (
      <p className="mt-1 text-[14px] text-neutral-500">{hint}</p>
    )}
    {error && (
      <p className="mt-1 text-[14px] text-[color:#B91C1C]">{error}</p>
    )}
  </div>
);

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export const TextInput = ({
  className,
  ...rest
}: TextInputProps): React.JSX.Element => (
  <input
    {...rest}
    className={`h-11 w-full border border-[var(--color-border-input)] bg-white px-3 text-[16px] outline-none focus:border-[var(--color-border-focus)] ${className ?? ''}`}
  />
);
