import { defineConfig } from "@playwright/test";

// Stub until the launcher hands workers, output paths and the reporter over a run plan (PRB.T-040).
export default defineConfig({
  testDir: ".",
  testMatch: "suite.spec.ts",
  retries: 0,
  repeatEach: 1,
  forbidOnly: true,
  fullyParallel: true,
  workers: 1,
});
