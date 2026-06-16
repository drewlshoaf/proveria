// Shared DTOs, enums, and domain types used across apps and packages.
// See docs/v1 §4.3.

export {
  PROJECT_TEMPLATES,
  PROJECT_TEMPLATE_SLUGS,
  isProjectTemplateSlug,
  findProjectTemplate,
  type ProjectTemplate,
  type ProjectTemplateSlug,
} from './templates.js';

export {
  PLAN_RULES,
  PLAN_LIMITS,
  findPlanRules,
  findPlanLimits,
  type PlanSlug,
  type PlanRule,
  type PlanRules,
  type PlanLimits,
} from './plans.js';

export const SHARED_TYPES_PACKAGE_VERSION = '0.0.0';
