ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS project_noun text NOT NULL DEFAULT 'Project';
