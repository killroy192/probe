import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

interface PanelTabCloseButtonProps {
  children: ReactNode;
  label: string;
  onClick: () => void;
  tooltip?: string;
  /** `lg` is a 24px target with an accent hover, for a tab strip with room for it. */
  size?: "default" | "lg";
}

export function PanelTabCloseButton({
  children,
  label,
  onClick,
  tooltip,
  size = "default",
}: PanelTabCloseButtonProps) {
  const button = (
    <button
      type="button"
      className={cn(
        "cursor-pointer group/close relative flex shrink-0 items-center justify-center",
        size === "lg" ? "size-6 rounded-md hover:bg-accent" : "size-4 rounded-sm hover:bg-muted",
      )}
      aria-label={label}
      onClick={onClick}
    >
      <span className="relative flex size-3 items-center justify-center group-hover/tab:hidden group-focus-visible/close:hidden">
        {children}
      </span>
      <X className="hidden size-3 group-hover/tab:block group-focus-visible/close:block" />
    </button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup>{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
