import { useMemo, useState } from "react";
import { BoxSelect, Plus, Shield } from "lucide-react";
import { useCanonicalProject } from "../../contexts/CanonicalProjectContext";
import { useProjectStoreSelector } from "../../hooks/useStudioStoreSelector";
import {
  addDefaultHitbox,
  ensureRegionCollisionSet,
  listCollisionSets,
} from "./collisionCommands";

/**
 * Collision workspace surface on the canonical store.
 * Reachable when the Collision workspace is active in the shell.
 */
export function CollisionWorkspacePanel() {
  const canonical = useCanonicalProject();
  const project = useProjectStoreSelector(canonical.store, (state) => state.project);
  const regionIds = project.rootOrder.regionIds;
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const effectiveRegionId = selectedRegionId && regionIds.includes(selectedRegionId)
    ? selectedRegionId
    : (regionIds[0] ?? null);
  const [status, setStatus] = useState<string | null>(null);

  const sets = useMemo(() => listCollisionSets(project), [project]);
  const activeSets = useMemo(
    () =>
      sets.filter(
        (set) =>
          set.owner.type === "region" &&
          effectiveRegionId !== null &&
          set.owner.regionId === effectiveRegionId,
      ),
    [sets, effectiveRegionId],
  );

  const onEnsure = (): void => {
    if (!effectiveRegionId) {
      setStatus("Pick a region first.");
      return;
    }
    const now = new Date().toISOString();
    const result = ensureRegionCollisionSet(canonical.store, effectiveRegionId, {
      collisionSetId: `collision-set-${effectiveRegionId}`,
      commandId: `cmd-collision-ensure-${now}`,
      issuedAt: now,
    });
    setStatus(result.ok ? `Set ready · ${result.collisionSetId}` : result.message);
  };

  const onAddHitbox = (): void => {
    if (!effectiveRegionId) {
      setStatus("Pick a region first.");
      return;
    }
    const region = project.regions[effectiveRegionId];
    if (!region) {
      setStatus("Region missing.");
      return;
    }
    const now = new Date().toISOString();
    const ensure = ensureRegionCollisionSet(canonical.store, effectiveRegionId, {
      collisionSetId: `collision-set-${effectiveRegionId}`,
      commandId: `cmd-collision-ensure-${now}`,
      issuedAt: now,
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
      { commandId: `cmd-collision-add-${now}`, issuedAt: now },
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
        <h2 className="text-[11px] font-semibold tracking-wide">Collision</h2>
        <span className="ml-auto font-mono text-[10px] text-textMuted">
          {regionIds.length} region{regionIds.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 custom-scrollbar">
        <label className="flex flex-col gap-1.5">
          <span className="studio-section-label">Region</span>
          <select
            className="rounded-md border border-white/10 bg-input px-2.5 py-2 text-xs text-textMain outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            value={effectiveRegionId ?? ""}
            onChange={(event) => setSelectedRegionId(event.target.value || null)}
          >
            {regionIds.length === 0 ? (
              <option value="">No regions</option>
            ) : (
              regionIds.map((id: string) => (
                <option key={id} value={id}>
                  {project.regions[id]?.name ?? id}
                </option>
              ))
            )}
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-white/10 bg-surface px-3 text-xs font-semibold text-textMain hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            onClick={onEnsure}
            disabled={!effectiveRegionId}
          >
            <BoxSelect size={13} aria-hidden="true" />
            Ensure set
          </button>
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-white shadow-glow hover:bg-accentHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            onClick={onAddHitbox}
            disabled={!effectiveRegionId}
          >
            <Plus size={13} aria-hidden="true" />
            Add hitbox
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-white/8 bg-panel/80 p-2.5 custom-scrollbar">
          <h3 className="studio-section-label mb-2">Sets</h3>
          {regionIds.length === 0 ? (
            <p className="px-1 py-6 text-center text-[11px] text-textMuted">No regions</p>
          ) : activeSets.length === 0 ? (
            <p className="px-1 py-6 text-center text-[11px] text-textMuted">No set</p>
          ) : (
            <ul className="space-y-1.5">
              {activeSets.map((set) => (
                <li
                  key={set.id}
                  className="rounded-md border border-white/8 bg-surface/60 px-2.5 py-2 text-xs"
                >
                  <div className="truncate font-mono text-[11px] text-textMain">{set.id}</div>
                  <div className="mt-0.5 text-[10px] text-textMuted">
                    {set.shapes.length} shape{set.shapes.length === 1 ? "" : "s"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {status ? (
          <p className="text-[11px] text-textMuted" role="status">
            {status}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default CollisionWorkspacePanel;
