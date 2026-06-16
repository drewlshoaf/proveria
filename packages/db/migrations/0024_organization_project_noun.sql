ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS project_noun text NOT NULL DEFAULT 'Project';
