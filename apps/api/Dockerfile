# Dev-mode container for the api. Lightweight — runs `pnpm dev` (tsx
# watch) the same way you would locally. The image is intentionally
# unoptimized (no multi-stage, no production minify) because the goal
# is one-command `docker compose up` parity with the local pnpm dev
# workflow, NOT a pilot deployment artifact.
#
# Build context is the repo root; .dockerignore strips node_modules
# and build outputs so the context is ~10 MB.

FROM node:22-bookworm-slim

WORKDIR /repo

# Corepack pins pnpm to the version package.json declares (11.1.1).
RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

# Bring in the monorepo + install. Workspace + lockfile-first so pnpm
# resolves the per-package package.jsons before src copy.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps apps
COPY packages packages
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=development

EXPOSE 3001

# tsx watch reloads on src change inside the container.
CMD ["pnpm", "--filter", "@proveria/api", "dev"]
