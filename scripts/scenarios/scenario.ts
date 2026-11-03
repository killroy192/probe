import type { PointerPage } from "./browser.ts";
import type { ServerHandle } from "./server.ts";

export interface ScenarioContext {
  readonly server: ServerHandle;
  /** A fresh browser context signed in to this scenario's server. */
  readonly openPage: () => Promise<PointerPage>;
  /** A fresh browser context with no session. */
  readonly openAnonymousPage: () => Promise<PointerPage>;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  /** Absent while the story that delivers the scenario is not built. */
  readonly run?: (context: ScenarioContext) => Promise<void>;
}
