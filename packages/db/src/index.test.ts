import { describe, it, expect } from 'vitest';
import {
  DB_PACKAGE_VERSION,
  organizationRoleEnum,
  planEnum,
  roleEnum,
  workspaceAccessModeEnum,
  organizations,
  platformEnum,
  tenants,
  users,
  organizationMemberships,
  tenantMemberships,
  sessions,
  devices,
  devicePairingAttempts,
  emailVerificationTokens,
  passwordResetTokens,
  auditEvents,
} from './index.js';

describe('@proveria/db', () => {
  it('exports a semver version string', () => {
    expect(DB_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('declares the four plan tiers from docs/v1 §3', () => {
    expect(planEnum.enumValues).toEqual([
      'free',
      'team_starter',
      'team_pro',
      'enterprise',
    ]);
  });

  it('declares the three V1 roles from docs/v1 §8.3', () => {
    expect(roleEnum.enumValues).toEqual([
      'tenant_admin',
      'producer',
      'consumer',
    ]);
  });

  it('declares V5 organization membership modes', () => {
    expect(organizationRoleEnum.enumValues).toEqual([
      'organization_admin',
      'member',
    ]);
    expect(workspaceAccessModeEnum.enumValues).toEqual([
      'all_workspaces',
      'selected_workspaces',
      'none',
    ]);
  });

  it('declares Mac + Windows as the only V1 platforms', () => {
    expect(platformEnum.enumValues).toEqual(['darwin', 'win32']);
  });

  it('exposes every M2 table via the schema entry point', () => {
    // Just confirms the wiring; real persistence tests run against a live DB.
    expect(tenants).toBeDefined();
    expect(organizations).toBeDefined();
    expect(users).toBeDefined();
    expect(tenantMemberships).toBeDefined();
    expect(organizationMemberships).toBeDefined();
    expect(sessions).toBeDefined();
    expect(devices).toBeDefined();
    expect(devicePairingAttempts).toBeDefined();
    expect(emailVerificationTokens).toBeDefined();
    expect(passwordResetTokens).toBeDefined();
    expect(auditEvents).toBeDefined();
  });
});
