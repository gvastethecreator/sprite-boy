import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Command, Search } from "lucide-react";
import type {
  StudioCommand,
  StudioCommandContext,
  StudioCommandId,
  StudioCommandRegistry,
  StudioShortcut,
} from "../../core/studio";

interface CommandPaletteProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly registry: StudioCommandRegistry;
  readonly context: StudioCommandContext;
  readonly onExecute: (commandId: StudioCommandId) => void;
}

function shortcutTokens(shortcut: StudioShortcut | undefined): readonly string[] {
  if (!shortcut) return [];
  const modifiers = shortcut.modifiers.map((modifier) => {
    if (modifier === "primary") return "Ctrl/Cmd";
    return modifier[0].toUpperCase() + modifier.slice(1);
  });
  const code = shortcut.code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace(/^Comma$/, ",")
    .replace(/^Slash$/, "/");
  return [...modifiers, code];
}

function searchableText(command: StudioCommand): string {
  return [command.label, command.description, command.category, ...command.keywords]
    .join(" ")
    .toLocaleLowerCase();
}

const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  registry,
  context,
  onExecute,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery.length === 0) return registry.commands;
    return registry.commands.filter((command) => searchableText(command).includes(normalizedQuery));
  }, [query, registry]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setSelectedIndex(0);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const item = listRef.current?.children[selectedIndex];
    if (item instanceof HTMLElement && typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const execute = (command: StudioCommand) => {
    if (!registry.getState(command.id, context).enabled) return;
    onExecute(command.id);
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredCommands.length > 0) {
        setSelectedIndex((previous) => (previous + 1) % filteredCommands.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredCommands.length > 0) {
        setSelectedIndex((previous) =>
          (previous - 1 + filteredCommands.length) % filteredCommands.length,
        );
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = filteredCommands[selectedIndex];
      if (selected) execute(selected);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <section
        aria-label="Command palette"
        className="flex max-h-[70vh] w-[min(640px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-white/10 bg-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-12 items-center gap-3 border-b border-border bg-input px-4">
          <Search className="text-textMuted" size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            aria-label="Search commands"
            className="h-full flex-1 border-none bg-transparent text-sm text-textMain outline-none placeholder:text-textMuted/50"
            placeholder="Search commands…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="rounded border border-border bg-panel px-1.5 py-0.5 font-mono text-[10px] text-textMuted">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="custom-scrollbar max-h-[360px] overflow-y-auto bg-panel p-2">
          {filteredCommands.length === 0 ? (
            <div className="py-10 text-center text-sm text-textMuted">No matching commands.</div>
          ) : (
            filteredCommands.map((command, index) => {
              const state = registry.getState(command.id, context);
              const shortcut = shortcutTokens(command.shortcuts[0]);
              const selected = index === selectedIndex;
              return (
                <button
                  key={command.id}
                  type="button"
                  disabled={!state.enabled}
                  title={state.enabled ? command.description : state.reason}
                  onClick={() => execute(command)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`mb-1 flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left transition-colors last:mb-0 ${
                    selected ? "bg-accent text-white" : "text-textMain hover:bg-tool"
                  } disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Command size={16} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{command.label}</span>
                      <span className={`block truncate text-[10px] ${selected ? "text-white/70" : "text-textMuted"}`}>
                        {state.enabled ? command.description : state.reason}
                      </span>
                    </span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${selected ? "bg-white/15" : "bg-tool text-textMuted"}`}>
                      {command.category}
                    </span>
                  </span>
                  {shortcut.length > 0 && (
                    <span className="ml-3 flex shrink-0 gap-1">
                      {shortcut.map((token) => (
                        <kbd key={token} className="min-w-5 rounded border border-current/20 px-1 py-0.5 text-center font-mono text-[9px]">
                          {token}
                        </kbd>
                      ))}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-border bg-panelHeader px-3 py-1.5 text-[10px] text-textMuted">
          <span>Commands reflect the active workspace.</span>
          <span className="flex items-center gap-1.5">
            Arrows to navigate <ArrowRight size={10} aria-hidden="true" /> Enter to run
          </span>
        </footer>
      </section>
    </div>
  );
};

export default CommandPalette;
