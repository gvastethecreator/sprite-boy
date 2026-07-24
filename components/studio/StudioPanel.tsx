import { X } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

export type StudioPanelVariant = "sidebar" | "drawer" | "default";

export interface StudioPanelProps
  extends Omit<HTMLAttributes<HTMLElement>, "children" | "aria-label"> {
  /** Accessible name for the complementary panel and its visible heading. */
  readonly label: string;
  readonly children?: ReactNode;
  /** Visual placement hint; it never changes ownership or project state. */
  readonly variant?: StudioPanelVariant;
  /** Optional close affordance for drawers/temporary sidebars. */
  readonly onClose?: () => void;
  /** Accessible label for the close control. */
  readonly closeLabel?: string;
  /** Extra classes applied to the panel surface. */
  readonly panelClassName?: string;
}

const VARIANT_CLASS_NAMES: Record<StudioPanelVariant, string> = {
  default: "flex min-h-0 flex-col overflow-hidden border border-white/8 bg-panel",
  sidebar:
    "flex min-h-0 flex-col overflow-hidden border border-white/8 bg-panel",
  drawer:
    "flex min-h-0 flex-col overflow-hidden border border-white/8 bg-panel shadow-modal",
};

/** A stateless semantic sidebar/drawer surface for Studio workspaces. */
export function StudioPanel({
  label,
  children,
  variant = "default",
  onClose,
  closeLabel,
  panelClassName = "",
  className,
  ...panelAttributes
}: StudioPanelProps) {
  return (
    <aside
      {...panelAttributes}
      aria-label={label}
      data-studio-panel="true"
      data-studio-panel-variant={variant}
      className={[VARIANT_CLASS_NAMES[variant], className, panelClassName]
        .filter(Boolean)
        .join(" ")}
    >
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-panelHeader/95 px-3">
        <h2 className="min-w-0 truncate text-[11px] font-semibold tracking-wide text-textMain">
          {label}
        </h2>
        {onClose ? (
          <button
            type="button"
            aria-label={closeLabel ?? `Close ${label}`}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-textMuted transition-colors hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">{children}</div>
    </aside>
  );
}

export default StudioPanel;
