import type { StudioShortcut } from "../../core/studio";

/** Human-readable tokens shared by command palette and shortcut reference. */
export function studioShortcutTokens(shortcut: StudioShortcut): readonly string[] {
  const modifiers = shortcut.modifiers.map((modifier) => {
    if (modifier === "primary") return "Ctrl/Cmd";
    return modifier[0].toUpperCase() + modifier.slice(1);
  });
  const code = shortcut.code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace(/^Comma$/, ",")
    .replace(/^Slash$/, "/");
  return Object.freeze([...modifiers, code]);
}
