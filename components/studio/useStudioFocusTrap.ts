import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

/** A ref to an element that can receive focus. */
export type StudioFocusRef = RefObject<HTMLElement | null>;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "audio[controls]",
  "video[controls]",
  "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

function isHiddenFromKeyboard(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return true;
  if (element.closest("[inert], [aria-hidden=\"true\"]")) return true;

  // `getComputedStyle` is available in jsdom and prevents hidden controls from
  // becoming the first focus target without relying on layout measurements.
  if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return true;
  }

  return false;
}

/** Return focusable descendants in DOM order, excluding disabled/hidden items. */
export function getStudioFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !isHiddenFromKeyboard(element),
  );
}

function focusElement(element: HTMLElement | null): void {
  if (!element || !element.isConnected || isHiddenFromKeyboard(element)) return;
  element.focus();
}

export interface UseStudioFocusTrapOptions {
  readonly isOpen: boolean;
  readonly containerRef: StudioFocusRef;
  readonly initialFocusRef?: StudioFocusRef;
  readonly restoreFocusRef?: StudioFocusRef;
  readonly restoreFocus?: boolean;
}

export interface UseStudioFocusTrapResult {
  readonly handleKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * Keep keyboard focus inside an open surface and return it to the exact
 * element that opened that surface when it closes.
 *
 * The trap listens on the surface itself instead of `document`, so it does
 * not leave global listeners behind and naturally scopes nested UI controls.
 */
export function useStudioFocusTrap({
  isOpen,
  containerRef,
  initialFocusRef,
  restoreFocusRef,
  restoreFocus = true,
}: UseStudioFocusTrapOptions): UseStudioFocusTrapResult {
  const wasOpenRef = useRef(false);
  const restoreTargetRef = useRef<HTMLElement | null>(null);

  const restoreFocusToTrigger = useCallback(() => {
    const target = restoreTargetRef.current;
    restoreTargetRef.current = null;
    wasOpenRef.current = false;
    if (restoreFocus) focusElement(target);
  }, [restoreFocus]);

  useLayoutEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      const explicitRestoreTarget = restoreFocusRef?.current;
      const activeElement = typeof document !== "undefined" ? document.activeElement : null;
      restoreTargetRef.current =
        explicitRestoreTarget ?? (activeElement instanceof HTMLElement ? activeElement : null);
      wasOpenRef.current = true;

      const container = containerRef.current;
      if (!container) return;

      const initialTarget = initialFocusRef?.current;
      const firstFocusable = getStudioFocusableElements(container)[0] ?? null;
      const target =
        initialTarget && container.contains(initialTarget) ? initialTarget : firstFocusable;
      focusElement(target ?? container);
      return;
    }

    if (!isOpen && wasOpenRef.current) restoreFocusToTrigger();
  }, [containerRef, initialFocusRef, isOpen, restoreFocusRef, restoreFocusToTrigger]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;

      const container = containerRef.current;
      if (!container) return;

      const focusableElements = getStudioFocusableElements(container);
      if (focusableElements.length === 0) {
        event.preventDefault();
        focusElement(container);
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      const activeElement = typeof document !== "undefined" ? document.activeElement : null;

      if (event.shiftKey) {
        if (activeElement === firstFocusable || activeElement === container || !container.contains(activeElement)) {
          event.preventDefault();
          focusElement(lastFocusable);
        }
        return;
      }

      if (activeElement === lastFocusable || activeElement === container || !container.contains(activeElement)) {
        event.preventDefault();
        focusElement(firstFocusable);
      }
    },
    [containerRef],
  );

  // This effect covers a parent that conditionally removes the dialog in the
  // same render that closes it while the normal `isOpen=false` path handles
  // controlled teardown. Checking connection status keeps the cleanup inert
  // during React StrictMode's effect replay (the node is still connected).
  useEffect(
    () => () => {
      if (wasOpenRef.current && !containerRef.current?.isConnected) {
        restoreFocusToTrigger();
      }
    },
    [containerRef, restoreFocusToTrigger],
  );

  return { handleKeyDown };
}

/** Track reduced-motion preference only while the surface is mounted/open. */
export function useStudioPrefersReducedMotion(enabled: boolean): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      if (!enabled) setPrefersReducedMotion(false);
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updatePreference);
      return () => mediaQuery.removeEventListener("change", updatePreference);
    }

    mediaQuery.addListener?.(updatePreference);
    return () => mediaQuery.removeListener?.(updatePreference);
  }, [enabled]);

  return prefersReducedMotion;
}
