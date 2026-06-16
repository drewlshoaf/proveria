import type {
  Result,
  RpcError,
  RpcMethodName,
  RpcMethods,
} from '@desktop/rpc-types';

declare global {
  interface Window {
    proveria?: {
      rpc: <M extends RpcMethodName>(envelope: {
        v: 1;
        method: M;
        args: RpcMethods[M]['request'];
      }) => Promise<Result<RpcMethods[M]['response'], RpcError>>;
    };
  }
}

export const SESSION_EXPIRED_EVENT = 'proveria:session-expired';
export const SESSION_EXPIRED_MESSAGE =
  'Your desktop session ended. Sign in again to continue.';

const isSessionExpiredError = (error: RpcError): boolean =>
  error.code === 'session_expired' ||
  error.message === SESSION_EXPIRED_MESSAGE ||
  error.message.includes('failed: 401');

const call = <M extends RpcMethodName>(
  method: M,
  args: RpcMethods[M]['request'],
): Promise<Result<RpcMethods[M]['response'], RpcError>> => {
  if (window.proveria) {
    return window.proveria.rpc({ v: 1, method, args }).then((result) => {
      if (!result.ok && isSessionExpiredError(result.error)) {
        window.dispatchEvent(
          new CustomEvent(SESSION_EXPIRED_EVENT, {
            detail: { message: SESSION_EXPIRED_MESSAGE },
          }),
        );
      }
      return result;
    });
  }
  return Promise.resolve(devFallback(method));
};

const devFallback = <M extends RpcMethodName>(
  method: M,
): Result<RpcMethods[M]['response'], RpcError> => {
  if (method === 'auth.currentSession') {
    return { ok: true, value: null as RpcMethods[M]['response'] };
  }
  return {
    ok: false,
    error: {
      code: 'desktop_bridge_unavailable',
      message: 'Open this screen in the desktop app to use local signing.',
    },
  };
};

export const rpc = {
  auth: {
    register: (args: RpcMethods['auth.register']['request']) =>
      call('auth.register', args),
    signIn: (args: RpcMethods['auth.signIn']['request']) =>
      call('auth.signIn', args),
    oidcProviders: (args: RpcMethods['auth.oidcProviders']['request']) =>
      call('auth.oidcProviders', args),
    oidcSignIn: (args: RpcMethods['auth.oidcSignIn']['request']) =>
      call('auth.oidcSignIn', args),
    signOut: () =>
      call('auth.signOut', {} as RpcMethods['auth.signOut']['request']),
    switchWorkspace: (args: RpcMethods['auth.switchWorkspace']['request']) =>
      call('auth.switchWorkspace', args),
    currentSession: () =>
      call(
        'auth.currentSession',
        {} as RpcMethods['auth.currentSession']['request'],
      ),
  },
  projects: {
    list: (args: RpcMethods['projects.list']['request'] = {}) =>
      call('projects.list', args),
    create: (args: RpcMethods['projects.create']['request']) =>
      call('projects.create', args),
    archive: (args: RpcMethods['projects.archive']['request']) =>
      call('projects.archive', args),
    restore: (args: RpcMethods['projects.restore']['request']) =>
      call('projects.restore', args),
  },
  attestations: {
    createWholeFile: (
      args: RpcMethods['attestations.createWholeFile']['request'],
    ) => call('attestations.createWholeFile', args),
    ocrPdf: (args: RpcMethods['attestations.ocrPdf']['request']) =>
      call('attestations.ocrPdf', args),
    list: (args: RpcMethods['attestations.list']['request']) =>
      call('attestations.list', args),
    recent: (args: RpcMethods['attestations.recent']['request'] = {}) =>
      call('attestations.recent', args),
    get: (args: RpcMethods['attestations.get']['request']) =>
      call('attestations.get', args),
    receipt: (args: RpcMethods['attestations.receipt']['request']) =>
      call('attestations.receipt', args),
    openReceiptPdf: (
      args: RpcMethods['attestations.openReceiptPdf']['request'],
    ) => call('attestations.openReceiptPdf', args),
    accessGrants: {
      list: (args: RpcMethods['attestations.accessGrants.list']['request']) =>
        call('attestations.accessGrants.list', args),
      create: (
        args: RpcMethods['attestations.accessGrants.create']['request'],
      ) => call('attestations.accessGrants.create', args),
      revoke: (
        args: RpcMethods['attestations.accessGrants.revoke']['request'],
      ) => call('attestations.accessGrants.revoke', args),
    },
    accessRequests: {
      list: (
        args: RpcMethods['attestations.accessRequests.list']['request'] = {},
      ) => call('attestations.accessRequests.list', args),
      approve: (
        args: RpcMethods['attestations.accessRequests.approve']['request'],
      ) => call('attestations.accessRequests.approve', args),
      deny: (
        args: RpcMethods['attestations.accessRequests.deny']['request'],
      ) => call('attestations.accessRequests.deny', args),
    },
  },
  devices: {
    list: () =>
      call('devices.list', {} as RpcMethods['devices.list']['request']),
    listForWorkspace: () =>
      call(
        'devices.listForWorkspace',
        {} as RpcMethods['devices.listForWorkspace']['request'],
      ),
    revoke: (args: RpcMethods['devices.revoke']['request']) =>
      call('devices.revoke', args),
    revokeForWorkspace: (
      args: RpcMethods['devices.revokeForWorkspace']['request'],
    ) => call('devices.revokeForWorkspace', args),
  },
  externalIdentities: {
    list: () =>
      call(
        'externalIdentities.list',
        {} as RpcMethods['externalIdentities.list']['request'],
      ),
    connect: (args: RpcMethods['externalIdentities.connect']['request']) =>
      call('externalIdentities.connect', args),
    disconnect: (
      args: RpcMethods['externalIdentities.disconnect']['request'],
    ) => call('externalIdentities.disconnect', args),
  },
  tenant: {
    workspaces: {
      create: (args: RpcMethods['tenant.workspaces.create']['request']) =>
        call('tenant.workspaces.create', args),
      archive: (args: RpcMethods['tenant.workspaces.archive']['request']) =>
        call('tenant.workspaces.archive', args),
      restore: (args: RpcMethods['tenant.workspaces.restore']['request']) =>
        call('tenant.workspaces.restore', args),
    },
    organizationSettings: {
      update: (
        args: RpcMethods['tenant.organizationSettings.update']['request'],
      ) => call('tenant.organizationSettings.update', args),
    },
    members: {
      list: () =>
        call(
          'tenant.members.list',
          {} as RpcMethods['tenant.members.list']['request'],
        ),
      remove: (args: RpcMethods['tenant.members.remove']['request']) =>
        call('tenant.members.remove', args),
      updateAccess: (
        args: RpcMethods['tenant.members.updateAccess']['request'],
      ) => call('tenant.members.updateAccess', args),
    },
    invitations: {
      list: () =>
        call(
          'tenant.invitations.list',
          {} as RpcMethods['tenant.invitations.list']['request'],
        ),
      create: (args: RpcMethods['tenant.invitations.create']['request']) =>
        call('tenant.invitations.create', args),
      revoke: (args: RpcMethods['tenant.invitations.revoke']['request']) =>
        call('tenant.invitations.revoke', args),
    },
    audit: {
      list: (args: RpcMethods['tenant.audit.list']['request'] = {}) =>
        call('tenant.audit.list', args),
      export: (args: RpcMethods['tenant.audit.export']['request']) =>
        call('tenant.audit.export', args),
    },
    evidenceExport: {
      manifest: (args: RpcMethods['tenant.evidenceExport.manifest']['request']) =>
        call('tenant.evidenceExport.manifest', args),
      createJob: (
        args: RpcMethods['tenant.evidenceExport.jobs.create']['request'],
      ) => call('tenant.evidenceExport.jobs.create', args),
      listJobs: (
        args: RpcMethods['tenant.evidenceExport.jobs.list']['request'] = {},
      ) => call('tenant.evidenceExport.jobs.list', args),
      getJob: (args: RpcMethods['tenant.evidenceExport.jobs.get']['request']) =>
        call('tenant.evidenceExport.jobs.get', args),
      bundle: (
        args: RpcMethods['tenant.evidenceExport.jobs.bundle']['request'],
      ) => call('tenant.evidenceExport.jobs.bundle', args),
    },
  },
};
