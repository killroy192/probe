// @effect-diagnostics globalFetch:off - The scenario reads the server's public descriptor directly.

import { ORCHESTRATION_PROTOCOL_VERSION, WsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { RpcClient, type RpcClientError, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";

import type { PointerPage } from "./browser.ts";

const decodeTicket = Schema.decodeUnknownSync(Schema.Struct({ ticket: Schema.String }));
const decodeDescriptor = Schema.decodeUnknownSync(Schema.Struct({ environmentId: Schema.String }));

export const environmentId = async (origin: string): Promise<string> =>
  decodeDescriptor(await (await fetch(`${origin}/.well-known/t3/environment`)).json())
    .environmentId;

/** Signs the ticket request in as the browser `page` (its cookie) or with a bearer token. */
export type RpcAuth = PointerPage | { readonly bearerToken: string };

async function websocketTicket(origin: string, auth: RpcAuth): Promise<string> {
  const url = `${origin}/api/auth/websocket-ticket`;
  if ("bearerToken" in auth) {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${auth.bearerToken}` },
    });
    if (!response.ok) throw new Error(`WebSocket ticket request failed: ${response.status}`);
    return decodeTicket(await response.json()).ticket;
  }
  const response = await auth.request.post(url);
  if (!response.ok()) throw new Error(`WebSocket ticket request failed: ${response.status()}`);
  return decodeTicket(await response.json()).ticket;
}

async function rpcProtocol(origin: string, auth: RpcAuth) {
  const ticket = await websocketTicket(origin, auth);
  const socket = Socket.layerWebSocket(
    `${origin.replace("http:", "ws:")}/ws?orchestrationProtocol=${ORCHESTRATION_PROTOCOL_VERSION}&wsTicket=${encodeURIComponent(ticket)}`,
  ).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal));
  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(socket),
    Layer.provide(RpcSerialization.layerJson),
  );
}

export type WsClient = RpcClient.FromGroup<typeof WsRpcGroup, RpcClientError.RpcClientError>;

/** A WS RPC client signed in as the browser `page` or a bearer token, for driving the server where no UI exists yet. */
export async function connectRpc(
  origin: string,
  auth: RpcAuth,
): Promise<{ readonly client: WsClient; readonly close: () => Promise<void> }> {
  const protocol = await rpcProtocol(origin, auth);
  const scope = Scope.makeUnsafe();
  const client: WsClient = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.buildWithScope(protocol, scope);
      return yield* RpcClient.make(WsRpcGroup).pipe(
        Effect.provideContext(context),
        Scope.provide(scope),
      );
    }),
  );
  let closed: Promise<void> | undefined;
  return { client, close: () => (closed ??= Effect.runPromise(Scope.close(scope, Exit.void))) };
}
