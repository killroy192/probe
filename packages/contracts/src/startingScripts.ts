import * as Schema from "effect/Schema";

/**
 * A user's starting script: typed into a new shell once it is ready. `id` is its identity; names
 * and commands may repeat. Entries are not validated here: the file can be edited outside Probe.
 */
export const StartingScript = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  command: Schema.String,
});
export type StartingScript = typeof StartingScript.Type;

/** The default server's user list; `problem` says why a saved list could not be read. */
export const StartingScriptList = Schema.Struct({
  scripts: Schema.Array(StartingScript),
  problem: Schema.NullOr(Schema.String),
});
export type StartingScriptList = typeof StartingScriptList.Type;

/** The script a start asks for; the name is only for naming it when it left the list. */
export const StartingScriptChoice = Schema.Struct({ id: Schema.String, name: Schema.String });
export type StartingScriptChoice = typeof StartingScriptChoice.Type;

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The command's program: its first word after any leading `NAME=value` assignments. */
export function startingScriptProgram(command: string): string {
  const words = command.trim().split(/\s+/);
  return words.find((word) => !ENV_ASSIGNMENT.test(word)) ?? "";
}

/** What the modal shows for a script: its name, or its program when the name is empty. */
export function startingScriptLabel(script: StartingScript): string {
  return script.name.trim() || startingScriptProgram(script.command);
}
