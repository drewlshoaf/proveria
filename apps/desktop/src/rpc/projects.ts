import { signedRequest } from '../api-client.js';
import { loadSession } from '../session-store.js';

import { fail, ok, registerRpc } from './handlers.js';
import type { ProjectSummary } from './types.js';

interface ProjectListResponse {
  projects: ProjectSummary[];
}

interface ProjectCreateResponse {
  project: ProjectSummary;
}

const projectPath = async (suffix = ''): Promise<string> => {
  const session = await loadSession();
  if (!session) throw new Error('no_session');
  return `/tenants/${session.activeWorkspace.slug}/projects${suffix}`;
};

export const registerProjectRpc = (): void => {
  registerRpc('projects.list', async ({ includeArchived }) => {
    try {
      const projects = await signedRequest<ProjectListResponse>({
        method: 'GET',
        path: await projectPath(includeArchived ? '?includeArchived=true' : ''),
      });
      return ok(projects);
    } catch (err) {
      return fail(
        'projects_list_failed',
        err instanceof Error ? err.message : 'Could not load projects.',
      );
    }
  });

  registerRpc(
    'projects.create',
    async ({ slug, name, description }) => {
      try {
        const created = await signedRequest<ProjectCreateResponse>({
          method: 'POST',
          path: await projectPath(),
          body: {
            slug,
            name,
            ...(description?.trim()
              ? { description: description.trim() }
              : {}),
          },
        });
        return ok(created);
      } catch (err) {
        const body = (err as { body?: { error?: string } }).body;
        if (body?.error === 'slug_taken') {
          return fail('slug_taken', 'A project with that slug already exists.');
        }
        if (body?.error === 'invalid_slug') {
          return fail(
            'invalid_slug',
            'Use lowercase letters, numbers, and hyphens for the slug.',
          );
        }
        return fail(
          body?.error ?? 'project_create_failed',
          err instanceof Error ? err.message : 'Could not create project.',
        );
      }
    },
  );

  registerRpc('projects.archive', async ({ projectSlug }) =>
    updateArchivedState(projectSlug, 'archive'),
  );

  registerRpc('projects.restore', async ({ projectSlug }) =>
    updateArchivedState(projectSlug, 'restore'),
  );
};

const updateArchivedState = async (
  projectSlug: string,
  action: 'archive' | 'restore',
) => {
  try {
    const updated = await signedRequest<ProjectCreateResponse>({
      method: 'POST',
      path: await projectPath(`/${projectSlug}/${action}`),
      body: {},
    });
    return ok(updated);
  } catch (err) {
    const body = (err as { body?: { error?: string } }).body;
    const message =
      body?.error === 'already_archived'
        ? 'That project is already archived.'
        : body?.error === 'not_archived'
          ? 'That project is already active.'
          : body?.error === 'forbidden'
            ? 'Only workspace admins can change project archive status.'
            : err instanceof Error
              ? err.message
              : `Could not ${action} project.`;
    return fail(body?.error ?? `project_${action}_failed`, message);
  }
};
