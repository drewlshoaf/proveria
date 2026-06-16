#!/usr/bin/env node
// Build Electron main/preload bundles plus the React renderer.

'use strict';

const esbuild = require('esbuild');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');

const RUNTIME_EXTERNAL = [
  'electron',
  '@napi-rs/canvas',
  'pdfjs-dist',
  'tesseract.js',
  'tesseract.js-core',
];

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: RUNTIME_EXTERNAL,
  sourcemap: true,
  logLevel: 'info',
};

const mainBuild = esbuild.build({
  ...common,
  entryPoints: [path.join(rootDir, 'src', 'main.ts')],
  outfile: path.join(rootDir, 'dist', 'main.js'),
});

const preloadBuild = esbuild.build({
  ...common,
  entryPoints: [path.join(rootDir, 'src', 'preload.ts')],
  outfile: path.join(rootDir, 'dist', 'preload.js'),
});

const buildRenderer = () => {
  if (process.env.RENDERER_DEV === '1') return Promise.resolve();
  const res = spawnSync('pnpm', ['run', 'build:renderer'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(`renderer build failed (exit ${res.status})`);
  }
};

Promise.all([mainBuild, preloadBuild])
  .then(buildRenderer)
  .then(() => {
    console.log('[desktop:build] main.js + preload.js + renderer bundled');
  })
  .catch((err) => {
    console.error('[desktop:build] failed:', err);
    process.exit(1);
  });
