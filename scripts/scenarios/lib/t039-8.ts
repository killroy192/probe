import type { PointerPage } from "../browser.ts";
import { expected } from "./expect.ts";
import { type ShellFollower, shellsIn } from "./shells.ts";
import {
  cancelModal,
  openModal,
  scriptItems,
  selectedScriptKey,
  startFromModal,
} from "./ui/plusModal.ts";

/** The starting scripts "Create shell" offers for `project`, by label in order; closes the modal. */
export async function offeredScripts(page: PointerPage, project: string) {
  await openModal(page, project, { script: null });
  await selectedScriptKey(page);
  const offered = await scriptItems(page);
  await cancelModal(page);
  return offered;
}

/** The starting script "Create shell" preselects for `project` ("plain" for Plain shell). */
export async function preselectedScript(page: PointerPage, project: string) {
  await openModal(page, project, { script: null });
  const key = await selectedScriptKey(page);
  await cancelModal(page);
  return key;
}

/** Starts `script` in `project` through "Create shell" and returns the shell once it is listed. */
export async function startScriptThroughModal(
  page: PointerPage,
  shells: ShellFollower,
  project: string,
  script: string,
) {
  await openModal(page, project, { script });
  expected({
    what: `the refusal of the ${script} start in ${project}`,
    expected: null,
    found: await startFromModal(page),
  });
  const [started] = await shellsIn(shells.lists, project, 1);
  return started!;
}
