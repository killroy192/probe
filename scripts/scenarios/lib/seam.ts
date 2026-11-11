// Test-only seam (PRB.T-021): the browser learns a second server without the connect flow.
// PRB.T-023 replaces it with the real connect flow.

import { deriveWsBaseUrl, normalizeHttpBaseUrl } from "@t3tools/shared/advertisedEndpoint";

import type { PointerPage } from "../browser.ts";
import type { ServerHandle } from "../server.ts";
import { environmentId, serverToken } from "./api.ts";
import { pageSettled } from "./navigate.ts";

// Mirrors `apps/web/src/connection/storage.ts`; R1 fails if the app stops reading this shape.
const DATABASE_NAME = "t3code:connection-runtime";
const CATALOG_STORE = "catalog";
const CATALOG_KEY = "document";

export interface SavedServer {
  readonly environmentId: string;
  readonly origin: string;
  /** The bearer token the browser now holds for this server. */
  readonly bearerToken: string;
}

/**
 * Saves `server` in the browser's connection catalog, as a paired bearer environment would be,
 * then reloads so the app's connection runtime reads it.
 */
export async function saveServerInBrowser(
  page: PointerPage,
  server: ServerHandle,
  label: string,
): Promise<SavedServer> {
  const id = await environmentId(server.origin);
  const bearerToken = await serverToken(server);
  const httpBaseUrl = normalizeHttpBaseUrl(server.origin);
  // The id the app derives when it pairs a bearer environment (`bearerConnectionId`).
  const connectionId = `bearer:${id}:${new URL(httpBaseUrl).origin}`;
  const document = JSON.stringify({
    schemaVersion: 1,
    targets: [{ _tag: "BearerConnectionTarget", environmentId: id, label, connectionId }],
    profiles: [
      {
        _tag: "BearerConnectionProfile",
        connectionId,
        environmentId: id,
        label,
        httpBaseUrl,
        wsBaseUrl: deriveWsBaseUrl(httpBaseUrl),
      },
    ],
    credentials: [
      { connectionId, credential: { _tag: "BearerConnectionCredential", token: bearerToken } },
    ],
    remoteDpopTokens: [],
    disabledEnvironmentIds: [],
  });
  // The app creates the catalog store when it boots; written earlier, the store is missing.
  await pageSettled(page, "saving a server in the browser");
  // A string, since this package has no DOM types; it runs in the page.
  await page.evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open(${JSON.stringify(DATABASE_NAME)});
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(${JSON.stringify(CATALOG_STORE)}, "readwrite");
      transaction.objectStore(${JSON.stringify(CATALOG_STORE)}).put(${JSON.stringify(document)}, ${JSON.stringify(CATALOG_KEY)});
      transaction.oncomplete = () => { database.close(); resolve(undefined); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  })`);
  await page.reload();
  return { environmentId: id, origin: server.origin, bearerToken };
}
