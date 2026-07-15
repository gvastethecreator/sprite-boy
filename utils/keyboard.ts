/** True when keyboard input belongs to a text-editable control or custom textbox. */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element
    ? target
    : document.activeElement instanceof Element
      ? document.activeElement
      : null;
  if (!element) return false;
  return element.closest(
    'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])',
  ) !== null;
}
