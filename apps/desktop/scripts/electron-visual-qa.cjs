#!/usr/bin/env node
'use strict';

const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawn } = require('node:child_process');

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const electronPath = require('electron');
const userData = mkdtempSync(join(tmpdir(), 'proveria-desktop-visual-qa-'));
const screenshotDir = resolve(
  process.argv[2] ?? join(__dirname, '..', 'dist', 'visual-qa'),
);

const child = spawn(electronPath, ['.', '--proveria-smoke-test=auth'], {
  cwd: join(__dirname, '..'),
  stdio: 'inherit',
  env: {
    ...process.env,
    PROVERIA_DESKTOP_SCREENSHOT_DIR: screenshotDir,
    PROVERIA_TEST_USER_DATA: userData,
  },
});

child.on('close', (code, signal) => {
  rmSync(userData, { recursive: true, force: true });
  if (signal) {
    console.error(`[desktop:visual] electron exited by ${signal}`);
    process.exit(1);
  }
  if (code !== 0) {
    console.error(`[desktop:visual] electron failed with exit ${code}`);
    process.exit(code ?? 1);
  }
  console.log(`[desktop:visual] screenshots written to ${screenshotDir}`);
});
