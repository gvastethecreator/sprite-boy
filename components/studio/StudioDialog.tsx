import { useCallback, useLayoutEffect, useRef } from "react";
import type { HTMLAttributes, KeyboardEvent, ReactNode, RefObject } from "react";
import {
  useStudioFocusTrap,
  useStudioPrefersReducedMotion,
  type StudioFocusRef,
} from "./useStudioFocusTrap";

export interface StudioDialogProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onKeyDown" | "onClick"> {
  /** Whether the dialog is mounted and interactive. */
  readonly isOpen: boolean;
  /** Called by Escape, backdrop, or consumer-provided close controls. */
  readonly onClose: () => void;
  readonly children?: ReactNode;
  /** ID of the heading/control that names the dialog. */
  readonly labelledBy?: string;
  /** Explicit accessible name used when no labelledBy target is available. */
  readonly ariaLabel?: string;
  /** Element to receive focus when the dialog opens. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  /** Optional explicit trigger to restore focus to on close. */
  readonly restoreFocusRef?: RefObject<HTMLElement | null>;
  /** Restore focus to the trigger after close. Defaults to true. */
  readonly restoreFocus?: boolean;
  /** Close when Escape is pressed. Defaults to true. */
  readonly closeOnEscape?: boolean;
  /** Close when the backdrop itself is clicked. Defaults to true. */
  readonly closeOnBackdrop?: boolean;
  /** Classes applied to the dialog panel (the backdrop is not affected). */
  readonly panelClassName?: string;
  /** Optional classes applied to the full-screen backdrop. */
  readonly backdropClassName?: string;
  /** Called after the primitive handles keyboard focus/close behavior. */
  readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** Called when the backdrop is clicked, after close handling. */
  readonly onBackdropClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
}

const DEFAULT_BACKDROP_CLASS_NAME =
  "fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[10vh] backdrop-blur-sm";
const DEFAULT_PANEL_CLASS_NAME =
  "relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/10 bg-panel shadow-2xl";

/**
 * Accessible modal surface for Studio overlays.
 *
 * The component is intentionally controlled and stateless: callers own the
 * open state and project data, while this primitive owns only transient focus
 * behavior and close affordances.
 */
export function StudioDialog({
  isOpen,
  onClose,
  children,
  labelledBy,
  ariaLabel,
  initialFocusRef,
  restoreFocusRef,
  restoreFocus = true,
  closeOnEscape = true,
  closeOnBackdrop = true,
  panelClassName = "",
  backdropClassName = "",
  onKeyDown,
  onBackdropClick,
  className,
  id,
  ...dialogAttributes
}: StudioDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useStudioPrefersReducedMotion(isOpen);
  const { handleKeyDown: handleFocusTrapKeyDown } = useStudioFocusTrap({
    isOpen,
    containerRef: dialogRef as StudioFocusRef,
    initialFocusRef: initialFocusRef as StudioFocusRef | undefined,
    restoreFocusRef: restoreFocusRef as StudioFocusRef | undefined,
    restoreFocus,
  });

  useLayoutEffect(() => {
    if (!isOpen) return;
    // Keep the root keyboard-focusable as a deterministic fallback when a
    // dialog has no controls yet (for example, while content is loading).
    dialogRef.current?.setAttribute("tabindex", "-1");
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!event.defaultPrevented && event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        onClose();
      }

      if (!event.defaultPrevented) handleFocusTrapKeyDown(event);
      onKeyDown?.(event);
    },
    [closeOnEscape, handleFocusTrapKeyDown, onClose, onKeyDown],
  );

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      onBackdropClick?.(event);
      if (event.defaultPrevented || !closeOnBackdrop || event.target !== event.currentTarget) return;
      onClose();
    },
    [closeOnBackdrop, onBackdropClick, onClose],
  );

  if (!isOpen) return null;

  const motionClassName = prefersReducedMotion
    ? "transition-none"
    : "transition-opacity duration-150";

  return (
    <div
      className={[DEFAULT_BACKDROP_CLASS_NAME, motionClassName, backdropClassName].filter(Boolean).join(" ")}
      data-studio-dialog-backdrop="true"
      data-reduced-motion={prefersReducedMotion ? "true" : "false"}
      onClick={handleBackdropClick}
    >
      <div
        {...dialogAttributes}
        ref={dialogRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={ariaLabel ?? (labelledBy ? undefined : "Studio dialog")}
        tabIndex={-1}
        className={[DEFAULT_PANEL_CLASS_NAME, motionClassName, className, panelClassName]
          .filter(Boolean)
          .join(" ")}
        data-studio-dialog="true"
        data-reduced-motion={prefersReducedMotion ? "true" : "false"}
        onKeyDown={handleKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export default StudioDialog;
