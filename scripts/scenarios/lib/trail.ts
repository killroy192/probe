/** A failure inside a named stage of a scenario; code outside every stage is in the stage `setup`. */
export class StageFailure extends Error {
  readonly stage: string;
  override readonly cause: unknown;

  constructor(stage: string, cause: unknown) {
    super(`at stage "${stage}": ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "StageFailure";
    this.stage = stage;
    this.cause = cause;
  }
}

/** One setup call a scenario made: never auth data. */
export interface TrailNote {
  readonly call: string;
  readonly asked: unknown;
  readonly got: unknown;
}

/** What one run of a scenario did: its stages and the setup calls it made. */
export interface Trail {
  /** Runs `body` as the stage `name`; a throw is wrapped once as a `StageFailure`. */
  readonly stage: <A>(name: string, body: () => Promise<A>) => Promise<A>;
  /** Runs `body` with every stage name prefixed by `step`, for a composed scenario's steps. */
  readonly within: <A>(step: string, body: () => Promise<A>) => Promise<A>;
  readonly note: (entry: TrailNote) => void;
  readonly notes: () => ReadonlyArray<TrailNote>;
}

export function createTrail(): Trail {
  const notes: Array<TrailNote> = [];
  let prefix = "";
  return {
    stage: async (name, body) => {
      const stage = `${prefix}${name}`;
      try {
        return await body();
      } catch (cause) {
        throw cause instanceof StageFailure ? cause : new StageFailure(stage, cause);
      }
    },
    within: async (step, body) => {
      const outer = prefix;
      prefix = `${outer}${step}: `;
      try {
        return await body();
      } finally {
        prefix = outer;
      }
    },
    note: (entry) => {
      notes.push(entry);
    },
    notes: () => notes,
  };
}
