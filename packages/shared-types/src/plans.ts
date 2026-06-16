// V1 plan rules — the "plan-limit visibility" surface (docs/v1 §22.2).
//
// These are display values only. Entitlement *enforcement* lands in M13; this
// table just lets client surfaces show a tenant what its plan includes.

export type PlanSlug = 'free' | 'team_starter' | 'team_pro' | 'enterprise';

export interface PlanRule {
  label: string;
  value: string;
}

export interface PlanRules {
  slug: PlanSlug;
  name: string;
  rules: readonly PlanRule[];
}

export const PLAN_RULES: readonly PlanRules[] = [
  {
    slug: 'free',
    name: 'Free',
    rules: [
      { label: 'Users', value: '1 (personal tenant)' },
      { label: 'Public projects', value: '5' },
      { label: 'Private projects', value: 'Not available' },
      { label: 'Attestations', value: '1 per project' },
      { label: 'Verification', value: 'Scoped public' },
      { label: 'Storage', value: 'Small fixed default' },
      { label: 'Shingling', value: 'Not available' },
      { label: 'Receipt bundles', value: 'Not available' },
    ],
  },
  {
    slug: 'team_starter',
    name: 'Team Starter',
    rules: [
      { label: 'Users', value: '3' },
      { label: 'Public projects', value: 'Yes' },
      { label: 'Private projects', value: 'Yes' },
      { label: 'Attestations', value: '50 / month' },
      { label: 'Verification', value: 'Unlimited' },
      { label: 'Storage', value: '25 GB' },
      { label: 'Shingling', value: 'Yes' },
      { label: 'Receipt bundles', value: 'Yes' },
    ],
  },
  {
    slug: 'team_pro',
    name: 'Team Pro',
    rules: [
      { label: 'Users', value: '10' },
      { label: 'Public projects', value: 'Yes' },
      { label: 'Private projects', value: 'Yes' },
      { label: 'Attestations', value: '500 / month' },
      { label: 'Verification', value: 'Unlimited' },
      { label: 'Storage', value: '250 GB' },
      { label: 'Shingling', value: 'Yes' },
      { label: 'Receipt bundles', value: 'Yes' },
    ],
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    rules: [
      { label: 'Users', value: 'Custom' },
      { label: 'Public projects', value: 'Yes' },
      { label: 'Private projects', value: 'Yes' },
      { label: 'Attestations', value: 'Custom' },
      { label: 'Verification', value: 'Custom / fair use' },
      { label: 'Storage', value: 'Custom' },
      { label: 'Shingling', value: 'Yes' },
      { label: 'Receipt bundles', value: 'Yes' },
      { label: 'Customer-managed signing', value: 'Optional' },
      { label: 'Arbitrum anchoring', value: 'Optional' },
    ],
  },
] as const;

export const findPlanRules = (slug: string): PlanRules | undefined =>
  PLAN_RULES.find((p) => p.slug === slug);

// -----------------------------------------------------------------------
// Machine-readable plan limits (docs/v1 §22.2). PLAN_RULES above is the
// display-only mirror — keep both in sync.
//
// `null` means "no enforced cap at this layer" (Enterprise is mostly null
// because limits are tenant-configured outside V1 scope).
// -----------------------------------------------------------------------

export interface PlanLimits {
  /** Hard cap on non-deleted projects for the tenant. */
  projects: number | null;
  /** Hard cap on attestations within ONE project (Free only). */
  attestationsPerProject: number | null;
  /** Cap on attestations created within a UTC calendar month. */
  attestationsPerMonth: number | null;
  /** Hard cap on confirmed members (active memberships). */
  users: number | null;
  /** Hard cap on cumulative retained storage in BYTES. */
  storageBytes: number | null;
  /** Sliding-window verification cap: requests per minute per tenant. */
  verificationsPerMinute: number | null;
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const PLAN_LIMITS: Record<PlanSlug, PlanLimits> = {
  free: {
    projects: 5,
    attestationsPerProject: 1,
    attestationsPerMonth: null, // dominated by attestationsPerProject
    users: 1,
    storageBytes: 100 * MB,
    verificationsPerMinute: 6,
  },
  team_starter: {
    projects: null,
    attestationsPerProject: null,
    attestationsPerMonth: 50,
    users: 3,
    storageBytes: 25 * GB,
    verificationsPerMinute: 60,
  },
  team_pro: {
    projects: null,
    attestationsPerProject: null,
    attestationsPerMonth: 500,
    users: 10,
    storageBytes: 250 * GB,
    verificationsPerMinute: 120,
  },
  enterprise: {
    projects: null,
    attestationsPerProject: null,
    attestationsPerMonth: null,
    users: null,
    storageBytes: null,
    verificationsPerMinute: null, // fair-use, handled out-of-band
  },
} as const;

export const findPlanLimits = (slug: string): PlanLimits | undefined =>
  (PLAN_LIMITS as Record<string, PlanLimits>)[slug];
