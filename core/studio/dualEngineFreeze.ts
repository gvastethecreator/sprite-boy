/**
 * Measured dual-engine freeze flag (DIR-03).
 * While true, durable Slice/Compose/Collision facts must not dual-write to the legacy controller.
 * See docs/architecture/DUAL_ENGINE_FREEZE.md.
 */
export const DUAL_ENGINE_FREEZE_ACTIVE = true as const;

export function assertDualEngineFreeze(): void {
  if (!DUAL_ENGINE_FREEZE_ACTIVE) {
    throw new Error("Dual-engine freeze was lifted without an X1 retirement plan.");
  }
}
