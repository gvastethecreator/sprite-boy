import React from "react";
import { X, Keyboard, Command } from "lucide-react";
import { STUDIO_COMMANDS } from "../../core/studio";
import { StudioDialog } from "../studio/StudioDialog";
import { studioShortcutTokens } from "../studio/shortcutPresentation";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ShortcutRow = ({ keys, desc }: { keys: readonly string[]; desc: string }) => (
  <div className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-0">
    <span className="min-w-0 text-sm leading-5 text-textMain">{desc}</span>
    <div className="flex max-w-[64%] shrink-0 flex-nowrap justify-end gap-1">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono border border-white/20 text-white min-w-[24px] text-center"
        >
          {k}
        </kbd>
      ))}
    </div>
  </div>
);

const STUDIO_SHORTCUT_ROWS = Object.freeze(STUDIO_COMMANDS.flatMap((command) =>
  command.shortcuts.map((shortcut, index) => Object.freeze({
    id: `${command.id}-${index}`,
    keys: studioShortcutTokens(shortcut),
    description: index === 0 ? command.label : `${command.label} (alternate)`,
  })),
));

const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  return (
    <StudioDialog
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="studio-help-title"
      backdropClassName="items-center pt-4"
      panelClassName="max-w-md border-border"
    >
        <div className="flex items-center justify-between gap-3 border-b border-border bg-panelHeader px-4 py-3 sm:px-6 sm:py-4">
          <h2 id="studio-help-title" className="flex min-w-0 items-center gap-2 text-base font-semibold text-textMain sm:text-lg">
            <Keyboard size={20} className="shrink-0 text-accent" aria-hidden="true" />
            <span className="truncate">Keyboard Shortcuts</span>
          </h2>
          <button
            type="button"
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-textMuted transition-colors hover:bg-white/10 hover:text-textMain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="custom-scrollbar max-h-[70vh] overflow-y-auto bg-app p-4 sm:p-6">
          <h3 className="text-xs font-bold text-textMuted uppercase tracking-wider mb-3 flex items-center gap-2">
            <Command size={12} aria-hidden="true" /> Studio commands
          </h3>
          <div className="mb-6 space-y-1">
            {STUDIO_SHORTCUT_ROWS.map((row) => (
              <ShortcutRow key={row.id} keys={row.keys} desc={row.description} />
            ))}
          </div>

          <h3 className="text-xs font-bold text-textMuted uppercase tracking-wider mb-3 flex items-center gap-2">
            <Command size={12} aria-hidden="true" /> Canvas & Navigation
          </h3>
          <div className="mb-6 space-y-1">
            <ShortcutRow keys={["Space + Drag"]} desc="Pan View" />
            <ShortcutRow keys={["Wheel"]} desc="Scroll Vertical" />
            <ShortcutRow keys={["Ctrl/Cmd", "Wheel"]} desc="Zoom In / Out" />
          </div>

          <h3 className="text-xs font-bold text-textMuted uppercase tracking-wider mb-3 flex items-center gap-2">
            <Command size={12} aria-hidden="true" /> Editing
          </h3>
          <div className="mb-6 space-y-1">
            <ShortcutRow keys={["Delete"]} desc="Delete Selection" />
            <ShortcutRow keys={["Arrows"]} desc="Nudge Selection (1px)" />
            <ShortcutRow keys={["Shift", "Arrows"]} desc="Nudge Selection (10px)" />
          </div>

          <h3 className="text-xs font-bold text-textMuted uppercase tracking-wider mb-3 flex items-center gap-2">
            <Command size={12} aria-hidden="true" /> Animation
          </h3>
          <div className="mb-6 space-y-1">
            <ShortcutRow keys={["Space"]} desc="Play / Pause" />
            <ShortcutRow keys={["←", "→"]} desc="Prev / Next Frame" />
          </div>

        </div>

        <div className="flex justify-center border-t border-border bg-panel px-4 py-3 text-[11px] text-textMuted">
          Press <kbd className="mx-1 rounded bg-white/10 px-1.5 py-0.5">Esc</kbd> to close
        </div>
    </StudioDialog>
  );
};

export default HelpModal;
