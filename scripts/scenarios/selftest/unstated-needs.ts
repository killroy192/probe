import { defineCheck } from "../scenario.ts";

/**
 * States no needs, then tries each one: on a sandbox every attempt is refused naming the need, and
 * the scenario fails listing them. Picked only by id; on its own server nothing is refused.
 */
export const unstatedNeeds = defineCheck(import.meta.url, {
  id: "T5",
  title: "tries needs it did not state",
  needs: {},
  run: async ({ server, startSecondServer }) => {
    const refused: Array<string> = [];
    for (const attempt of [
      () => server.stopShellHost(),
      () => startSecondServer(),
      () => server.restart(),
      () => server.stop(),
    ]) {
      await attempt().catch((error: unknown) =>
        refused.push(error instanceof Error ? error.message : String(error)),
      );
    }
    throw new Error(
      refused.length === 0 ? "No attempt was refused." : `Refused: ${refused.join(" | ")}`,
    );
  },
});
