# Dev-mode container for the verifier web app (Next.js 15).

FROM node:22-bookworm-slim

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps apps
COPY packages packages
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=development

EXPOSE 3003

CMD ["pnpm", "--filter", "@proveria/verifier", "dev"]
