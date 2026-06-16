import { describe, it, expect } from 'vitest';
import {
  PROJECT_TEMPLATES,
  PROJECT_TEMPLATE_SLUGS,
  SHARED_TYPES_PACKAGE_VERSION,
  findProjectTemplate,
  isProjectTemplateSlug,
} from './index.js';

describe('@proveria/shared-types', () => {
  it('exports a semver version string', () => {
    expect(SHARED_TYPES_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exposes the six fixed V1 project templates', () => {
    expect(PROJECT_TEMPLATES).toHaveLength(6);
    expect(PROJECT_TEMPLATE_SLUGS).toContain('general_provenance');
    expect(PROJECT_TEMPLATE_SLUGS).toContain('ai_training_corpus');
    expect(PROJECT_TEMPLATE_SLUGS).toContain('legal_evidence');
    expect(PROJECT_TEMPLATE_SLUGS).toContain('research_dataset');
    expect(PROJECT_TEMPLATE_SLUGS).toContain('software_release');
    expect(PROJECT_TEMPLATE_SLUGS).toContain('media_archive');
  });

  it('isProjectTemplateSlug acts as a type guard', () => {
    expect(isProjectTemplateSlug('general_provenance')).toBe(true);
    expect(isProjectTemplateSlug('not_a_template')).toBe(false);
  });

  it('findProjectTemplate returns the template object', () => {
    const t = findProjectTemplate('software_release');
    expect(t?.name).toBe('Software Release');
  });
});
