import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/**
 * Fade-in + slight scale for modal overlays.
 * Attach `containerRef` to the outermost overlay div.
 */
export function useModalEntrance() {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = containerRef.current;
      if (!el) return;
      const backdrop = el;
      const panel = el.querySelector("[data-modal-panel]") as HTMLElement | null;

      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(backdrop, { opacity: 1 });
        if (panel) gsap.set(panel, { opacity: 1, y: 0, scale: 1 });
        return;
      }

      gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" });
      if (panel) {
        gsap.fromTo(
          panel,
          { opacity: 0, y: 16, scale: 0.97 },
          { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: "power2.out", delay: 0.05 },
        );
      }
    },
    { scope: containerRef },
  );

  return containerRef;
}

/**
 * Logo pop animation triggered externally.
 * Returns `triggerRef` (attach to element) and `play()`.
 */
export function useLogoPop() {
  const triggerRef = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);

  useGSAP(
    () => {
      const el = triggerRef.current;
      if (!el) return;

      tl.current = gsap
        .timeline({ paused: true })
        .to(el, {
          scale: 1.3,
          rotation: 15,
          filter: "brightness(1.5)",
          duration: 0.25,
          ease: "back.out(1.7)",
        })
        .to(el, {
          scale: 1,
          rotation: 0,
          filter: "brightness(1)",
          duration: 0.25,
          ease: "power2.inOut",
        });
    },
    { scope: triggerRef },
  );

  const play = () => tl.current?.restart();

  return { triggerRef, play };
}
