import { ipcMain } from 'electron';

import {
  type Result,
  type RpcEnvelope,
  type RpcError,
  type RpcMethodName,
  type RpcMethods,
} from './types.js';

export type RpcHandler<M extends RpcMethodName> = (
  args: RpcMethods[M]['request'],
) => Promise<Result<RpcMethods[M]['response'], RpcError>>;

type Registry = {
  [M in RpcMethodName]?: RpcHandler<M>;
};

const registry: Registry = {};

export const registerRpc = <M extends RpcMethodName>(
  method: M,
  handler: RpcHandler<M>,
): void => {
  registry[method] = handler as Registry[M];
};

export const mountRpc = (): void => {
  ipcMain.handle(
    'rpc',
    async (_event, envelope: RpcEnvelope): Promise<Result<unknown, RpcError>> => {
      if (!envelope || envelope.v !== 1 || typeof envelope.method !== 'string') {
        return badEnvelope();
      }
      const handler = registry[envelope.method as RpcMethodName];
      if (!handler) {
        return fail(
          'method_not_found',
          `RPC method "${envelope.method}" is not registered.`,
        );
      }
      try {
        return await (handler as RpcHandler<RpcMethodName>)(envelope.args);
      } catch (err) {
        return fail(
          'unexpected_error',
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  );
};

const badEnvelope = (): Result<unknown, RpcError> =>
  fail('bad_envelope', 'RPC envelope is malformed.');

export const ok = <T>(value: T): Result<T, RpcError> => ({ ok: true, value });

export const fail = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Result<never, RpcError> => ({
  ok: false,
  error: details ? { code, message, details } : { code, message },
});
