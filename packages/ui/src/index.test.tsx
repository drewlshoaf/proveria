import { describe, it, expect } from 'vitest';
import {
  Button,
  Card,
  CodeBlock,
  Container,
  Eyebrow,
  Field,
  Header,
  LinkButton,
  MicroLabel,
  Mono,
  StatusBadge,
  TextInput,
  UI_PACKAGE_VERSION,
  attestationStateKind,
} from './index';

describe('@proveria/ui', () => {
  it('exports a semver version string', () => {
    expect(UI_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exposes the brand component set', () => {
    expect(Container).toBeTypeOf('function');
    expect(Header).toBeTypeOf('function');
    expect(Button).toBeTypeOf('function');
    expect(LinkButton).toBeTypeOf('function');
    expect(Card).toBeTypeOf('function');
    expect(Eyebrow).toBeTypeOf('function');
    expect(MicroLabel).toBeTypeOf('function');
    expect(CodeBlock).toBeTypeOf('function');
    expect(Mono).toBeTypeOf('function');
    expect(StatusBadge).toBeTypeOf('function');
    expect(Field).toBeTypeOf('function');
    expect(TextInput).toBeTypeOf('function');
  });

  it('attestationStateKind maps known states correctly', () => {
    expect(attestationStateKind('confirmed')).toBe('done');
    expect(attestationStateKind('validating')).toBe('in_progress');
    expect(attestationStateKind('failed_needs_review')).toBe('failed');
    expect(attestationStateKind('something_else')).toBe('neutral');
  });
});
