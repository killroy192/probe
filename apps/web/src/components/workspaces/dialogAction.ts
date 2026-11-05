import { useRef, useState } from "react";

/**
 * One server action at a time for a dialog: a second click while one runs is ignored (EC-7),
 * and the refusal it returns is kept to show inline.
 */
export function useDialogAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tells one refusal from the next when both read the same.
  const [attempt, setAttempt] = useState(0);
  // A second click lands before React re-renders with the button disabled.
  const busy = useRef(false);

  /** Runs `work`, which returns the reason it failed or null; returns whether it succeeded. */
  const run = async (work: () => Promise<string | null>): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError(null);
    setAttempt((count) => count + 1);
    const settle = () => {
      busy.current = false;
      setPending(false);
    };
    const failure = await work().then(
      (reason) => {
        settle();
        return reason;
      },
      (cause: unknown) => {
        settle();
        throw cause;
      },
    );
    setError(failure);
    return failure === null;
  };

  return {
    pending,
    error,
    attempt,
    run,
    /** Whether a close may go ahead: not while an action runs. */
    canClose: () => !busy.current,
    clearError: () => setError(null),
  };
}
