// Singleton drizzle client + close handle for the api process.

import { createClient, type ClientHandle } from '@proveria/db';

import { config } from './config.js';

let handle: ClientHandle | undefined;

export const getDb = (): ClientHandle => {
  if (!handle) {
    handle = createClient({ url: config.databaseUrl, max: 10 });
  }
  return handle;
};

export const closeDb = async (): Promise<void> => {
  if (handle) {
    await handle.close();
    handle = undefined;
  }
};
