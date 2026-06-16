# Dev-mode container for the worker. Uses Playwright's official image
# because the receipt-PDF render path drives Chromium, which needs a
# pile of system libs. The Playwright image ships them + the matching
# browser version already installed (~1.5 GB; one-time pull).
#
# @napi-rs/canvas works on glibc Linux via its prebuilt
# @napi-rs/canvas-linux-x64-gnu / -linux-arm64-gnu sub-package.
# tesseract.js + pdfjs-dist are pure JS/WASM, no native deps.

FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /repo

# The Playwright image ships node 20; we want 22 to match the rest of
# the workspace. Install via nodesource.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps apps
COPY packages packages
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=development

# Worker is a queue consumer — no exposed port.
CMD ["pnpm", "--filter", "@proveria/worker", "dev"]
