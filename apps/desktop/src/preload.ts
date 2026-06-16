import { contextBridge, ipcRenderer } from 'electron';

import type {
  Result,
  RpcEnvelope,
  RpcError,
  RpcMethodName,
} from './rpc/types.js';

contextBridge.exposeInMainWorld('proveria', {
  rpc: <M extends RpcMethodName>(
    envelope: RpcEnvelope<M>,
  ): Promise<Result<unknown, RpcError>> =>
    ipcRenderer.invoke('rpc', envelope) as Promise<Result<unknown, RpcError>>,
});
