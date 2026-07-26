import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoxSelect, Plus, Scissors, Shield } from "lucide-react";
import type { CollisionShapeType } from "../../core/project";
import { useCanonicalProject } from "../../contexts/CanonicalProjectContext";
import { useProjectStoreSelector } from "../../hooks/useStudioStoreSelector";
import { SelectControl } from "../../components/toolcraft";
import { ComposeCanvasWorkspace } from "../compose/canvas/ComposeCanvasWorkspace";
import { resolveFittedSceneViewport } from "../compose/canvas/sceneViewportFit";
import {
  addDefaultHitbox,
  ensureRegionCollisionSet,
  listCollisionSets,
} from "./collisionCommands";
import { createCollisionRegionProjection } from "./collisionProjection";

const SHAPE_STYLES: Record<CollisionShapeType, string> = {
  hitbox: "border-rose-400 bg-rose-400/15",
  hurtbox: "border-amber-300 bg-amber-300/15",
  solid: "border-sky-300 bg-sky-300/15",
  trigger: "border-violet-300 bg-violet-300/15",
};

function commandMetadata(commandId: string, issuedAt: string) {
  return {
    commandId,
    origin: "user" as const,
    history: "ignore" as const,
    issuedAt,
  };
}

/** Canonical collision editor with the active region as its main surface. */
export function CollisionWorkspacePanel() {
  const canonical = useCanonicalProject();
  const project = useProjectStoreSelector(canonical.store, (state) => state.project);
  const regionIds = project.rootOrder.regionIds.filter((id) => project.regions[id]);
  const selectedRegionId = project.workspace.selectedRegionId;
  const effectiveRegionId = selectedRegionId && regionIds.includes(selectedRegionId)
    ? selectedRegionId
    : (regionIds[0] ?? null);
  const region = effectiveRegionId ? project.regions[effectiveRegionId] : undefined;
  const [status, setStatus] = useState<string | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const target = canvasHostRef.current;
    if (!target || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver((entries) => {
      const latest = entries.at(-1)?.contentRect;
      if (latest) setCanvasSize({ width: latest.width, height: latest.height });
    });
    observer.observe(target);
    setCanvasSize({ width: target.clientWidth, height: target.clientHeight });
    return () => observer.disconnect();
  }, [effectiveRegionId]);

  const sets = useMemo(() => listCollisionSets(project), [project]);
  const activeSets = useMemo(
    () => sets.filter((set) => (
      set.owner.type === "region"
      && effectiveRegionId !== null
      && set.owner.regionId === effectiveRegionId
    )),
    [effectiveRegionId, sets],
  );
  const shapes = activeSets.flatMap((set) => (
    set.shapes.map((shape) => ({ setId: set.id, shape }))
  ));
  const fittedViewport = region
    ? resolveFittedSceneViewport(
        { scale: 1, offset: { x: 0, y: 0 } },
        region.bounds.width,
        region.bounds.height,
        canvasSize.width,
        canvasSize.height,
      )
    : { scale: 1, offset: { x: 0, y: 0 } };
  const collisionProjection = useCallback((
    state: Parameters<typeof createCollisionRegionProjection>[0],
    workspace: Parameters<typeof createCollisionRegionProjection>[1],
  ) => createCollisionRegionProjection(state, workspace, effectiveRegionId as string), [effectiveRegionId]);

  const selectRegion = (regionId: string): void => {
    const issuedAt = new Date().toISOString();
    const result = canonical.store.dispatch({
      command: { type: "workspace.update", patch: { selectedRegionId: regionId } },
      metadata: commandMetadata(`cmd-collision-select-${issuedAt}`, issuedAt),
    });
    setStatus(result.result.ok ? null : "The region could not be selected.");
  };

  const addHitbox = (): void => {
    if (!effectiveRegionId || !region) return;
    const issuedAt = new Date().toISOString();
    const ensure = ensureRegionCollisionSet(canonical.store, effectiveRegionId, {
      collisionSetId: `collision-set-${effectiveRegionId}`,
      commandId: `cmd-collision-ensure-${issuedAt}`,
      issuedAt,
    });
    if (!ensure.ok) {
      setStatus(ensure.message);
      return;
    }
    const add = addDefaultHitbox(
      canonical.store,
      ensure.collisionSetId,
      `shape-${effectiveRegionId}-${Date.now()}`,
      {
        x: Math.max(0, Math.floor(region.bounds.width / 4)),
        y: Math.max(0, Math.floor(region.bounds.height / 4)),
        width: Math.max(1, Math.floor(region.bounds.width / 2)),
        height: Math.max(1, Math.floor(region.bounds.height / 2)),
      },
      { commandId: `cmd-collision-add-${issuedAt}`, issuedAt },
    );
    setStatus(add.ok ? "Hitbox added." : add.message);
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-workspace text-textMain"
      data-testid="collision-workspace-panel"
      aria-label="Collision workspace"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-white/8 bg-panelHeader/95 px-3">
        <Shield size={14} className="text-textMuted" aria-hidden="true" />
        <h1 className="text-[11px] font-semibold tracking-wide">Collision</h1>
        <span className="ml-auto font-mono text-[10px] text-textMuted">
          {regionIds.length} region{regionIds.length === 1 ? "" : "s"}
        </span>
      </header>

      {!region ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="max-w-sm text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-panel text-textMuted">
              <Scissors size={22} aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-base font-semibold">Create a region first</h2>
            <p className="mt-2 text-xs leading-relaxed text-textMuted">
              Collision shapes attach to regions from Slice.
            </p>
            <a
              href="#/studio/slice"
              className="btn-primary mt-4 inline-flex min-h-9 items-center justify-center rounded-md px-4 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Open Slice
            </a>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <div className="flex shrink-0 flex-wrap items-end gap-2">
            <SelectControl
              className="min-w-52 flex-1 sm:max-w-80"
              name="Region"
              value={effectiveRegionId ?? ""}
              options={regionIds.map((id) => ({ value: id, label: project.regions[id]?.name ?? id }))}
              onValueChange={selectRegion}
            />
            <button
              type="button"
              className="btn-primary inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={addHitbox}
            >
              <Plus size={13} aria-hidden="true" />
              Add hitbox
            </button>
          </div>

          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div
              ref={canvasHostRef}
              data-collision-canvas
              className="relative min-h-[320px] overflow-hidden rounded-lg border border-white/10 bg-panel/60"
            >
              <ComposeCanvasWorkspace
                store={canonical.store}
                assets={canonical.assets}
                ariaLabel="Collision source preview"
                projectionFactory={collisionProjection}
              />
              <div className="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
                {shapes.map(({ setId, shape }) => (
                  <span
                    key={`${setId}:${shape.id}`}
                    className={`absolute border-2 outline outline-1 outline-black/90 ${SHAPE_STYLES[shape.type]}`}
                    style={{
                      left: fittedViewport.offset.x + shape.bounds.x * fittedViewport.scale,
                      top: fittedViewport.offset.y + shape.bounds.y * fittedViewport.scale,
                      width: shape.bounds.width * fittedViewport.scale,
                      height: shape.bounds.height * fittedViewport.scale,
                    }}
                  />
                ))}
              </div>
              <div className="pointer-events-none absolute bottom-2 left-2 z-30 rounded-md border border-white/10 bg-black/65 px-2 py-1 font-mono text-[10px] text-textMuted">
                {region.bounds.width} × {region.bounds.height}
              </div>
            </div>

            <aside className="custom-scrollbar min-h-0 overflow-y-auto rounded-lg border border-white/10 bg-panel/80 p-3" aria-label="Collision shapes">
              <div className="mb-3 flex items-center gap-2">
                <BoxSelect size={14} className="text-textMuted" aria-hidden="true" />
                <h2 className="text-xs font-semibold">Shapes</h2>
                <span data-collision-shape-count className="ml-auto font-mono text-[10px] text-textMuted">{shapes.length}</span>
              </div>
              {shapes.length === 0 ? (
                <div className="rounded-md border border-dashed border-white/10 px-3 py-8 text-center">
                  <p className="text-xs font-semibold">No shapes yet</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-textMuted">Add a hitbox to mark the active area.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {shapes.map(({ setId, shape }, index) => (
                    <li key={`${setId}:${shape.id}`} className="rounded-md border border-white/8 bg-surface/70 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-sm border ${SHAPE_STYLES[shape.type]}`} aria-hidden="true" />
                        <span className="text-xs font-semibold capitalize">{shape.type}</span>
                        <span className="ml-auto font-mono text-[9px] text-textMuted">{String(index + 1).padStart(2, "0")}</span>
                      </div>
                      <p className="mt-1.5 font-mono text-[10px] text-textMuted">
                        {shape.bounds.x}, {shape.bounds.y} · {shape.bounds.width} × {shape.bounds.height}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>

          {status ? <p className="shrink-0 text-[11px] text-textMuted" role="status">{status}</p> : null}
        </div>
      )}
    </section>
  );
}

export default CollisionWorkspacePanel;
