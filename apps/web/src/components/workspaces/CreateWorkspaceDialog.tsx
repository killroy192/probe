import { workspaceNameProblem } from "@t3tools/contracts";
import { useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

/** Asks for a name; the server's reason is shown when it refuses (taken name, storage failure). */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const close = (next: boolean) => {
    if (pending) return;
    if (!next) {
      setName("");
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    const problem = workspaceNameProblem(name);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setPending(true);
    const failure = await onCreate(name.trim());
    setPending(false);
    if (failure !== null) {
      setError(failure);
      return;
    }
    setName("");
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogPopup className="max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>
              A workspace holds the folders and shells you work on.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Name</span>
              <Input
                autoFocus
                aria-invalid={error !== null}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
            </label>
            {error === null ? null : (
              <p role="alert" className="mt-2 text-sm text-destructive-foreground">
                {error}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
