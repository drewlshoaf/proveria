// Shared brand components for Proveria web surfaces. The visual system is
// documented in docs/brand/style-guide.md; this package implements the
// components named there with Tailwind class strings that the consumer's
// build picks up via @source scanning.

export { Container } from './components/Container';
export { Header } from './components/Header';
export { Button, LinkButton } from './components/Button';
export { Card } from './components/Card';
export { Eyebrow, MicroLabel } from './components/Eyebrow';
export { CodeBlock, Mono } from './components/CodeBlock';
export {
  StatusBadge,
  attestationStateKind,
  type StatusBadgeProps,
  type StatusKind,
} from './components/StatusBadge';
export { Field, TextInput } from './components/TextInput';
export { PullQuote } from './components/PullQuote';
export { ScenarioBlock } from './components/ScenarioBlock';
export { ComplianceStatus } from './components/ComplianceStatus';

export type { ContainerProps } from './components/Container';
export type { HeaderProps } from './components/Header';
export type { CardProps } from './components/Card';
export type { CodeBlockProps } from './components/CodeBlock';
export type { FieldProps, TextInputProps } from './components/TextInput';
export type { ScenarioBlockProps } from './components/ScenarioBlock';
export type { ComplianceStatusProps } from './components/ComplianceStatus';

export const UI_PACKAGE_VERSION = '0.0.0';
