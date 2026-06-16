#!/usr/bin/env node
'use strict';

const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn } = require('node:child_process');

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const electronPath = require('electron');
const runSmoke = (mode) =>
  new Promise((resolve, reject) => {
    const userData = mkdtempSync(join(tmpdir(), `proveria-desktop-smoke-${mode}-`));
    const child = spawn(electronPath, ['.', `--proveria-smoke-test=${mode}`], {
      cwd: join(__dirname, '..'),
      stdio: 'inherit',
      env: {
        ...process.env,
        PROVERIA_TEST_USER_DATA: userData,
      },
    });

    child.on('close', (code, signal) => {
      rmSync(userData, { recursive: true, force: true });
      if (signal) {
        reject(new Error(`electron ${mode} smoke exited by ${signal}`));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`electron ${mode} smoke failed with exit ${code}`));
      }
    });
  });

void (async () => {
  await runSmoke('signed-out');
  await runSmoke('auth');
  await runSmoke('auth-producer');
})().catch((err) => {
  console.error('[desktop:smoke] failed:', err);
  process.exit(1);
});
