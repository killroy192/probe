import type { PointerPage } from "./browser.ts";
import type { ServerHandle } from "./server.ts";

export interface ScenarioContext {
  readonly server: ServerHandle;
  /**
   * New for every run of a scenario. A scenario that may share a server puts it in the workspace
   * names and folders it makes, so they never meet those of an earlier run on that server.
   */
  readonly runId: string;
  /** A fresh browser context signed in to this scenario's server. */
  readonly openPage: () => Promise<PointerPage>;
  /** A fresh browser context with no session. */
  readonly openAnonymousPage: () => Promise<PointerPage>;
  /**
   * Starts another Probe server on its own throwaway home and port, stopped with the scenario.
   * `serverBin` exists for the harness self-test of a server that never starts.
   */
  readonly startSecondServer: (options?: { readonly serverBin?: string }) => Promise<ServerHandle>;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  /** Absent while the story that delivers the scenario is not built. */
  readonly run?: (context: ScenarioContext) => Promise<void>;
}
