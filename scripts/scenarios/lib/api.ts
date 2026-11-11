// @effect-diagnostics globalFetch:off - The scenario reads the server's public descriptor directly.

import { ORCHESTRATION_PROTOCOL_VERSION, WsRpcGroup } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { RpcClient, type RpcClientError, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";

import type { PointerPage } from "../browser.ts";
import type { ServerHandle } from "../server.ts";
import type { Trail } from "./trail.ts";

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
  // Playwright pools keep-alive sockets across contexts; one the server is just closing as idle
  // resets this request (ECONNRESET), so the connection is never left in the pool.
  const response = await auth.request.post(url, { headers: { connection: "close" } });
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

/** A WS RPC connection to `server`, signed in as the browser `page` (its cookie) or a bearer token. */
export async function connectApi(
  server: Pick<ServerHandle, "origin">,
  auth: RpcAuth,
): Promise<{ readonly client: WsClient; readonly close: () => Promise<void> }> {
  const protocol = await rpcProtocol(server.origin, auth);
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

export type ApiConnection = Awaited<ReturnType<typeof connectApi>>;

/** Runs `use` with a client signed in as `auth`, by default `server`'s bearer token, closed afterwards. */
export async function withClient<A, E>(
  server: ServerHandle,
  use: (client: WsClient) => Effect.Effect<A, E>,
  auth?: RpcAuth,
): Promise<A> {
  const api = await connectApi(server, auth ?? { bearerToken: await serverToken(server) });
  try {
    return await Effect.runPromise(use(api.client));
  } finally {
    await api.close();
  }
}

/** A bearer token for `server`, minted by its own CLI the way a headless client gets one. */
export async function issueBearerToken(server: ServerHandle): Promise<string> {
  const output = await server.cli(["auth", "session", "issue", "--token-only"]);
  const token = output.trim().split("\n").at(-1)?.trim();
  if (!token) throw new Error("The server issued no bearer token.");
  return token;
}

const tokens = new WeakMap<ServerHandle, Promise<string>>();

/** `server`'s bearer token, minted once per server handle: each mint is a CLI start. */
export function serverToken(server: ServerHandle): Promise<string> {
  let token = tokens.get(server);
  if (token === undefined) {
    token = issueBearerToken(server);
    token.catch(() => tokens.delete(server));
    tokens.set(server, token);
  }
  return token;
}

/** A setup call the server refused or never answered; the message names the call and the reason. */
export class SetupError extends Error {
  readonly method: string;
  readonly asked: unknown;
  override readonly cause: unknown;

  constructor(method: string, asked: unknown, cause: unknown) {
    super(`setup call ${method} ${JSON.stringify(asked)} failed: ${reasonOf(cause)}`);
    this.name = "SetupError";
    this.method = method;
    this.asked = asked;
    this.cause = cause;
  }
}

function reasonOf(cause: unknown): string {
  if (typeof cause !== "object" || cause === null) return String(cause);
  const tag = "_tag" in cause && typeof cause._tag === "string" ? cause._tag : "Error";
  const message = cause instanceof Error ? cause.message : JSON.stringify(cause);
  return `${tag}: ${message}`;
}

/** Runs one setup call, notes what it asked and got on the trail, and fails as a `SetupError`. */
export async function call<A, E>(
  trail: Trail,
  method: string,
  asked: unknown,
  run: Effect.Effect<A, E>,
): Promise<A> {
  const exit = await Effect.runPromiseExit(run);
  if (Exit.isFailure(exit)) {
    const cause = Cause.squash(exit.cause);
    trail.note({ call: method, asked, got: { failed: reasonOf(cause) } });
    throw new SetupError(method, asked, cause);
  }
  trail.note({ call: method, asked, got: exit.value });
  return exit.value;
}
