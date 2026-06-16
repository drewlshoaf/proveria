// V1 fixed system templates. See docs/v1 §10.2 — Free uses public-only,
// paid tiers default to private. No tenant-created or tenant-edited templates
// in V1; this list is the entire surface.

export interface ProjectTemplate {
  /** Stable identifier used in API payloads and the database. */
  readonly slug: string;
  /** Human-readable name shown in UI. */
  readonly name: string;
  /** Short description of the intended use case. */
  readonly description: string;
}

export const PROJECT_TEMPLATES = [
  {
    slug: 'general_provenance',
    name: 'General Provenance',
    description: 'Default catch-all template suitable for most workflows.',
  },
  {
    slug: 'ai_training_corpus',
    name: 'AI Training Corpus',
    description: 'Provenance for model training data and source corpora.',
  },
  {
    slug: 'legal_evidence',
    name: 'Legal Evidence Package',
    description: 'Litigation, discovery, and case-file evidence collections.',
  },
  {
    slug: 'research_dataset',
    name: 'Research Dataset',
    description: 'Scientific and academic research materials.',
  },
  {
    slug: 'software_release',
    name: 'Software Release',
    description: 'Source archives, binaries, and signed software releases.',
  },
  {
    slug: 'media_archive',
    name: 'Media Archive',
    description: 'Image, video, audio, and mixed-document collections.',
  },
] as const satisfies readonly ProjectTemplate[];

export type ProjectTemplateSlug = (typeof PROJECT_TEMPLATES)[number]['slug'];

export const PROJECT_TEMPLATE_SLUGS: readonly ProjectTemplateSlug[] =
  PROJECT_TEMPLATES.map((t) => t.slug);

export const isProjectTemplateSlug = (
  value: string,
): value is ProjectTemplateSlug =>
  (PROJECT_TEMPLATE_SLUGS as readonly string[]).includes(value);

export const findProjectTemplate = (
  slug: string,
): ProjectTemplate | undefined =>
  PROJECT_TEMPLATES.find((t) => t.slug === slug);
