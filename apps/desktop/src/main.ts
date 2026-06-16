import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

import { registerAuthRpc } from './rpc/auth.js';
import { registerAttestationRpc } from './rpc/attestations.js';
import { registerDeviceRpc } from './rpc/devices.js';
import { mountRpc } from './rpc/handlers.js';
import { registerProjectRpc } from './rpc/projects.js';
import { registerTenantRpc } from './rpc/tenant.js';
import {
  registerSmokeRpc,
  runSmokeTest,
  type SmokeMode,
} from './smoke.js';

const RENDERER_DEV_URL = 'http://127.0.0.1:5173';
const smokeArg = process.argv.find((arg) =>
  arg.startsWith('--proveria-smoke-test'),
);
const SMOKE_TEST = smokeArg !== undefined;
const SMOKE_MODE: SmokeMode = smokeArg?.includes('=auth-producer')
  ? 'auth-producer'
  : smokeArg?.includes('=auth')
    ? 'auth'
    : 'signed-out';

app.setName('Proveria');
if (process.env.PROVERIA_TEST_USER_DATA) {
  app.setPath('userData', process.env.PROVERIA_TEST_USER_DATA);
}

let mainWindow: BrowserWindow | null = null;

const createMainWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Proveria',
    backgroundColor: '#FFFFFF',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.js'),
    },
  });

  if (process.env.RENDERER_DEV === '1') {
    void win.loadURL(RENDERER_DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(join(__dirname, 'renderer', 'index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.on('closed', () => {
    mainWindow = null;
  });
  if (SMOKE_TEST) runSmokeTest(win, SMOKE_MODE);
  return win;
};

void app.whenReady().then(() => {
  registerAuthRpc();
  registerProjectRpc();
  registerAttestationRpc();
  registerDeviceRpc();
  registerTenantRpc();
  if (SMOKE_MODE === 'auth' || SMOKE_MODE === 'auth-producer') {
    registerSmokeRpc(SMOKE_MODE);
  }
  mountRpc();
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
