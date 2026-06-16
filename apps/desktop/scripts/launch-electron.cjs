#!/usr/bin/env node
// Cross-platform Electron launcher.
//
// Strips ELECTRON_RUN_AS_NODE / ELECTRON_NO_ATTACH_CONSOLE from the env before
// spawning Electron. Both vars are set by VSCode (itself an Electron app) and
// by certain CI / IDE shells, and they cause Electron to run as plain Node —
// process.type ends up undefined, the API binding never loads, and
// require('electron') returns the binary path string instead of { app, ... }.
//
// Pass extra args after `--` (e.g. `pnpm dev -- --remote-debugging-port=9222`).

'use strict';

const { spawn } = require('node:child_process');

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const electronPath = require('electron');

const args = process.argv.length > 2 ? process.argv.slice(2) : ['.'];

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env: process.env,
});

child.on('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

const forward = (signal) => {
  child.kill(signal);
};
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));
