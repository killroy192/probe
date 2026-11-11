import { defineComposed } from "../scenario.ts";
import { wrongUiState } from "./diagnosis.ts";
import { returnsWorkspace, takesWorkspace } from "./handover.ts";
import { restartPersistence } from "./restart-persistence.ts";

/** Fails on purpose at step 2, so step 3 does not run. */
export const failsAtStepTwo = defineComposed(import.meta.url, {
  id: "T21",
  title: "a composed scenario whose second step fails",
  steps: [
    { scenario: returnsWorkspace },
    { scenario: wrongUiState },
    { scenario: takesWorkspace, given: { from: 1 } },
  ],
});

/** The same two atomic scenarios twice, each use with its own names and folders. */
export const handoverTwice = defineComposed(import.meta.url, {
  id: "T22",
  title: "two handovers of a workspace",
  steps: [
    { scenario: returnsWorkspace },
    { scenario: takesWorkspace, given: { from: 1 } },
    { scenario: returnsWorkspace },
    { scenario: takesWorkspace, given: { from: 3 } },
  ],
});

/** A step that restarts the server, so a sandbox refuses the whole scenario. */
export const withRestartStep = defineComposed(import.meta.url, {
  id: "T26",
  title: "a composed scenario with a restart step",
  steps: [{ scenario: returnsWorkspace }, { scenario: restartPersistence }],
});
