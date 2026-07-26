import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from "react";
import {
  FlipHorizontal2,
  FlipVertical2,
  Grid3X3,
  Lock,
  Move,
  RotateCcw,
  Unlock,
} from "lucide-react";
import type { AssetRepository } from "../../core/assets";
import type { Cel, CelTransform, EntityId, StudioProject } from "../../core/project";
import type { DeepReadonly, ProjectStore } from "../../core/stores";
import { useInteractionStore, useWorkspaceStore } from "../../contexts/StudioStoreContext";
import {
  useInteractionStoreSelector,
  useProjectStoreSelector,
  useWorkspaceStoreSelector,
} from "../../hooks/useStudioStoreSelector";
import { SegmentedControl, SelectControl, SliderControl, type ControlChangeMeta } from "../../components/toolcraft";
import { ComposeCanvasWorkspace } from "../compose/canvas/ComposeCanvasWorkspace";
import { snapComposeLayer } from "../compose/guides/composeGuideGeometry";
import { createCelTransformEditor, type CelTransformHistory } from "./frame/celTransformEditor";
import {
  createOnionSkinProjection,
  resolveOnionSkinNeighbors,
} from "./onion/onionSkinProjection";

let identity = 0;

function nextId(prefix: string): EntityId {
  identity += 1;
  try {
    const value = globalThis.crypto?.randomUUID?.();
    if (value) return `${prefix}-${value}`;
  } catch {
    // The local counter remains unique for this document lifetime.
  }
  return `${prefix}-${Date.now().toString(36)}-${identity.toString(36)}`;
}

function materializeTransform(value: DeepReadonly<CelTransform> | undefined): Required<CelTransform> {
  return {
    x: value?.x ?? 0,
    y: value?.y ?? 0,
    scaleX: value?.scaleX ?? 1,
    scaleY: value?.scaleY ?? 1,
    rotation: value?.rotation ?? 0,
    opacity: value?.opacity ?? 1,
    flipX: value?.flipX ?? false,
    flipY: value?.flipY ?? false,
  };
}

function celDimensions(project: DeepReadonly<StudioProject>, cel: DeepReadonly<Cel>) {
  if (cel.source.type === "region") {
    const region = project.regions[cel.source.regionId];
    return region ? { width: region.bounds.width, height: region.bounds.height } : null;
  }
  if (cel.source.type === "composition") {
    const composition = project.compositions[cel.source.compositionId];
    return composition ? { width: composition.width, height: composition.height } : null;
  }
  const variants = project.variantSets[cel.source.variantSetId];
  const compositionId = variants?.variants[variants.activeVariant];
  const composition = compositionId ? project.compositions[compositionId] : undefined;
  return composition ? { width: composition.width, height: composition.height } : null;
}

function historyFromControl(meta: ControlChangeMeta | undefined): CelTransformHistory {
  return meta?.history === "merge" && meta.historyGroup
    ? { mode: "coalesce", transactionId: meta.historyGroup }
    : { mode: "record" };
}

function NumberField({
  label,
  value,
  disabled,
  min,
  max,
  step = 1,
  onCommit,
}: {
  readonly label: string;
  readonly value: number;
  readonly disabled?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly onCommit: (value: number) => void;
}): ReactElement {
  return (
    <label className="min-w-0 space-y-1 text-[10px] font-semibold uppercase tracking-wide text-textMuted">
      {label}
      <input
        key={`${label}:${value}`}
        type="number"
        defaultValue={Number(value.toFixed(3))}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        className="min-h-8 w-full rounded-md border border-white/10 bg-input px-2 font-mono text-xs text-textMain outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45"
        onBlur={(event) => {
          const parsed = Number(event.currentTarget.value);
          if (Number.isFinite(parsed)) onCommit(parsed);
          else event.currentTarget.value = String(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.currentTarget.value = String(value);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

interface DragState {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly startX: number;
  readonly startY: number;
  readonly transactionId: EntityId;
}

export interface AnimateFrameWorkspaceProps {
  readonly store: ProjectStore;
  readonly assets: AssetRepository;
  readonly disabled?: boolean;
}

export function AnimateFrameWorkspace({ store, assets, disabled = false }: AnimateFrameWorkspaceProps) {
  const project = useProjectStoreSelector(store, (state) => state.project);
  const workspaceStore = useWorkspaceStore();
  const interactionStore = useInteractionStore();
  const animateViewport = useWorkspaceStoreSelector(
    workspaceStore,
    (state) => state.viewports.animate ?? { scale: 1, offset: { x: 0, y: 0 } },
  );
  const activeGuides = useInteractionStoreSelector(interactionStore, (state) => state.guides);
  const editor = useMemo(() => createCelTransformEditor({
    store,
    nextId: () => nextId("animate-command"),
    now: () => new Date().toISOString(),
  }), [store]);
  const selectedSequence = project.workspace.selectedSequenceId
    ? project.sequences[project.workspace.selectedSequenceId]
    : undefined;
  const sequence = selectedSequence ?? project.sequences[project.rootOrder.sequenceIds[0]];
  const selectedCelId = project.workspace.selectedCelIds?.find((id) => (
    project.cels[id]?.sequenceId === sequence?.id && sequence.celIds.includes(id)
  ));
  const celId = selectedCelId ?? sequence?.celIds.find((id) => project.cels[id] !== undefined);
  const cel = celId ? project.cels[celId] : undefined;
  const dimensions = cel ? celDimensions(project, cel) : null;
  const transform = materializeTransform(cel?.transform);
  const neighbors = sequence && cel
    ? resolveOnionSkinNeighbors(project, sequence.id, cel.id)
    : { previous: null, next: null };
  const [onionMode, setOnionMode] = useState("both");
  const [onionOpacity, setOnionOpacity] = useState(24);
  const [guidesEnabled, setGuidesEnabled] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const target = canvasHostRef.current;
    if (!target || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver((entries) => {
      const latest = entries.at(-1)?.contentRect;
      if (latest) setHostSize({ width: latest.width, height: latest.height });
    });
    observer.observe(target);
    setHostSize({ width: target.clientWidth, height: target.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    interactionStore.dispatch({ type: "interaction.setGuides", guides: [] });
  }, [interactionStore]);

  useEffect(() => {
    if (!sequence || !cel || selectedCelId) return;
    editor.select(sequence.id, cel.id);
  }, [cel, editor, selectedCelId, sequence]);

  const applyTransform = useCallback((
    patch: Partial<CelTransform>,
    history: CelTransformHistory = { mode: "record" },
  ) => {
    if (!cel) return false;
    const result = editor.setTransform(cel.id, patch, history);
    setFeedback(result.ok ? null : result.message);
    return result.ok;
  }, [cel, editor]);

  const previousProjection = useMemo(() => neighbors.previous
    ? ((state: Parameters<typeof createOnionSkinProjection>[0], workspace: Parameters<typeof createOnionSkinProjection>[1]) => (
        createOnionSkinProjection(state, workspace, neighbors.previous as EntityId)
      ))
    : null, [neighbors.previous]);
  const nextProjection = useMemo(() => neighbors.next
    ? ((state: Parameters<typeof createOnionSkinProjection>[0], workspace: Parameters<typeof createOnionSkinProjection>[1]) => (
        createOnionSkinProjection(state, workspace, neighbors.next as EntityId)
      ))
    : null, [neighbors.next]);

  if (!sequence || !cel || !dimensions) {
    return (
      <section className="flex h-full min-h-0 items-center justify-center bg-workspace p-6" aria-label="Frame alignment">
        <div className="max-w-md rounded-xl border border-white/10 bg-panel p-6 text-center">
          <h1 className="text-base font-semibold text-textMain">No frames to align</h1>
          <p className="mt-2 text-xs leading-relaxed text-textMuted">
            Import a video in Slice to create a canonical sequence, then return here to edit each frame.
          </p>
        </div>
      </section>
    );
  }

  const fitScale = hostSize.width > 0 && hostSize.height > 0
    ? Math.min(hostSize.width / dimensions.width, hostSize.height / dimensions.height)
    : 1;
  const displayViewport = animateViewport.scale > fitScale
    ? {
        scale: fitScale,
        offset: {
          x: (hostSize.width - dimensions.width * fitScale) / 2,
          y: (hostSize.height - dimensions.height * fitScale) / 2,
        },
      }
    : animateViewport;
  const guidePositions = guidesEnabled
    ? [
        ...[dimensions.width / 3, dimensions.width / 2, dimensions.width * 2 / 3]
          .map((position) => ({ axis: "x" as const, position, active: false })),
        ...[dimensions.height / 3, dimensions.height / 2, dimensions.height * 2 / 3]
          .map((position) => ({ axis: "y" as const, position, active: false })),
        ...activeGuides.map((guide) => ({ ...guide, active: true })),
      ]
    : [];
  const sourceLabel = cel.source.type === "region"
    ? project.regions[cel.source.regionId]?.name ?? "Region frame"
    : cel.source.type === "composition"
      ? project.compositions[cel.source.compositionId]?.name ?? "Composition frame"
      : "Variant frame";

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    interactionStore.dispatch({ type: "interaction.setDrag", session: null });
    interactionStore.dispatch({ type: "interaction.setGuides", guides: [] });
  };

  const handleDragMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || cel.locked) return;
    const scale = displayViewport.scale || 1;
    const rawX = drag.startX + (event.clientX - drag.clientX) / scale;
    const rawY = drag.startY + (event.clientY - drag.clientY) / scale;
    const snapped = snapComposeLayer({
      moving: {
        id: cel.id,
        x: dimensions.width / 2 + rawX,
        y: dimensions.height / 2 + rawY,
        width: dimensions.width,
        height: dimensions.height,
        scaleX: transform.scaleX,
        scaleY: transform.scaleY,
        rotation: transform.rotation,
      },
      others: [],
      canvas: dimensions,
      viewportScale: scale,
      enabled: guidesEnabled && !event.altKey,
    });
    interactionStore.dispatch({ type: "interaction.setGuides", guides: snapped.guides });
    applyTransform({
      x: snapped.x - dimensions.width / 2,
      y: snapped.y - dimensions.height / 2,
    }, { mode: "coalesce", transactionId: drag.transactionId });
  };

  const handleKeyboardMove = (event: KeyboardEvent<HTMLDivElement>) => {
    if (cel.locked || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const x = transform.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0);
    const y = transform.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
    applyTransform({ x, y });
  };

  const halfWidth = (
    Math.abs(dimensions.width * transform.scaleX * Math.cos(transform.rotation * Math.PI / 180)) +
    Math.abs(dimensions.height * transform.scaleY * Math.sin(transform.rotation * Math.PI / 180))
  ) / 2;
  const halfHeight = (
    Math.abs(dimensions.width * transform.scaleX * Math.sin(transform.rotation * Math.PI / 180)) +
    Math.abs(dimensions.height * transform.scaleY * Math.cos(transform.rotation * Math.PI / 180))
  ) / 2;

  return (
    <section aria-label="Frame alignment" className="flex h-full min-h-0 flex-col overflow-hidden bg-workspace text-textMain">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/10 bg-panel px-3 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">Frame alignment</h1>
          <p className="truncate font-mono text-[10px] text-textMuted">{sourceLabel} · {dimensions.width} × {dimensions.height}</p>
        </div>
        <SelectControl
          className="w-48"
          name="Sequence"
          showLabel={false}
          value={sequence.id}
          disabled={disabled}
          options={project.rootOrder.sequenceIds.flatMap((id) => {
            const item = project.sequences[id];
            return item ? [{ value: id, label: item.name }] : [];
          })}
          onValueChange={(id) => {
            const next = project.sequences[id];
            const first = next?.celIds.find((item) => project.cels[item]);
            if (next && first) editor.select(next.id, first);
          }}
        />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_272px]">
        <div ref={canvasHostRef} className="relative min-h-[300px] overflow-hidden border-r border-white/10 bg-workspace">
          <ComposeCanvasWorkspace store={store} assets={assets} ariaLabel="Current animation frame" />
          {previousProjection && onionMode !== "next" ? (
            <ComposeCanvasWorkspace
              store={store}
              assets={assets}
              projectionFactory={previousProjection}
              ariaLabel={null}
              hideDiagnostics
              transparentBackground
              className="pointer-events-none absolute inset-0 z-10 mix-blend-screen"
              style={{
                opacity: onionMode === "off" ? 0 : onionOpacity / 100,
                filter: "sepia(1) saturate(5) hue-rotate(315deg)",
              }}
            />
          ) : null}
          {nextProjection && onionMode !== "previous" ? (
            <ComposeCanvasWorkspace
              store={store}
              assets={assets}
              projectionFactory={nextProjection}
              ariaLabel={null}
              hideDiagnostics
              transparentBackground
              className="pointer-events-none absolute inset-0 z-10 mix-blend-screen"
              style={{
                opacity: onionMode === "off" ? 0 : onionOpacity / 100,
                filter: "sepia(1) saturate(5) hue-rotate(70deg)",
              }}
            />
          ) : null}
          {guidePositions.map((guide, index) => {
            const coordinate = (guide.axis === "x" ? displayViewport.offset.x : displayViewport.offset.y)
              + guide.position * displayViewport.scale;
            return (
              <span
                key={`${guide.axis}:${guide.position}:${index}`}
                aria-hidden="true"
                className={`pointer-events-none absolute z-30 ${guide.active ? "bg-amber-300" : "bg-sky-300/55"}`}
                style={guide.axis === "x"
                  ? { left: coordinate, top: 0, bottom: 0, width: guide.active ? 2 : 1 }
                  : { top: coordinate, left: 0, right: 0, height: guide.active ? 2 : 1 }}
              />
            );
          })}
          <div
            role="application"
            tabIndex={cel.locked || disabled ? -1 : 0}
            aria-label="Drag selected frame. Arrow keys move one pixel; Shift moves ten. Hold Alt to ignore snapping."
            className={`absolute inset-0 z-40 touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${cel.locked || disabled ? "cursor-not-allowed" : "cursor-move"}`}
            onPointerDown={(event) => {
              if (cel.locked || disabled || event.button !== 0) return;
              const transactionId = nextId("frame-drag");
              dragRef.current = {
                pointerId: event.pointerId,
                clientX: event.clientX,
                clientY: event.clientY,
                startX: transform.x,
                startY: transform.y,
                transactionId,
              };
              event.currentTarget.setPointerCapture?.(event.pointerId);
              interactionStore.dispatch({
                type: "interaction.setDrag",
                session: {
                  pointerId: event.pointerId,
                  transactionId,
                  target: { surfaceId: "animate-canvas", role: "cel", entityId: cel.id },
                  origin: { x: event.clientX, y: event.clientY },
                  current: { x: event.clientX, y: event.clientY },
                },
              });
            }}
            onPointerMove={handleDragMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onKeyDown={handleKeyboardMove}
          />
        </div>

        <aside className="custom-scrollbar min-h-0 overflow-y-auto bg-panel p-3" aria-label="Frame transform controls">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold"><Move size={14} aria-hidden="true" /> Transform</div>
            <button
              type="button"
              disabled={disabled}
              aria-label={cel.locked ? "Unlock frame" : "Lock frame"}
              className="rounded-md border border-white/10 p-1.5 text-textMuted hover:text-textMain focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
              onClick={() => editor.setLocked(cel.id, !cel.locked)}
            >
              {cel.locked ? <Lock size={13} aria-hidden="true" /> : <Unlock size={13} aria-hidden="true" />}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="X" value={transform.x} disabled={disabled || cel.locked} onCommit={(x) => applyTransform({ x })} />
            <NumberField label="Y" value={transform.y} disabled={disabled || cel.locked} onCommit={(y) => applyTransform({ y })} />
            <NumberField label="Width" value={dimensions.width * transform.scaleX} min={1} disabled={disabled || cel.locked} onCommit={(width) => applyTransform({ scaleX: width / dimensions.width })} />
            <NumberField label="Height" value={dimensions.height * transform.scaleY} min={1} disabled={disabled || cel.locked} onCommit={(height) => applyTransform({ scaleY: height / dimensions.height })} />
            <NumberField label="Scale X" value={transform.scaleX} min={0.01} max={32} step={0.01} disabled={disabled || cel.locked} onCommit={(scaleX) => applyTransform({ scaleX })} />
            <NumberField label="Scale Y" value={transform.scaleY} min={0.01} max={32} step={0.01} disabled={disabled || cel.locked} onCommit={(scaleY) => applyTransform({ scaleY })} />
            <NumberField label="Rotation" value={transform.rotation} step={1} disabled={disabled || cel.locked} onCommit={(rotation) => applyTransform({ rotation })} />
          </div>
          <SliderControl
            className="mt-3"
            name="Frame opacity"
            min={0}
            max={100}
            step={1}
            unit="%"
            value={Math.round(transform.opacity * 100)}
            disabled={disabled || cel.locked}
            onValueChange={(value, meta) => applyTransform({ opacity: value / 100 }, historyFromControl(meta))}
          />
          <div className="mt-3 grid grid-cols-3 gap-1" role="group" aria-label="Horizontal alignment">
            <button type="button" className="btn-secondary min-h-8 rounded-md text-[10px]" disabled={disabled || cel.locked} onClick={() => applyTransform({ x: halfWidth - dimensions.width / 2 })}>Left</button>
            <button type="button" className="btn-secondary min-h-8 rounded-md text-[10px]" disabled={disabled || cel.locked} onClick={() => applyTransform({ x: 0 })}>Center X</button>
            <button type="button" className="btn-secondary min-h-8 rounded-md text-[10px]" disabled={disabled || cel.locked} onClick={() => applyTransform({ x: dimensions.width / 2 - halfWidth })}>Right</button>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-1" role="group" aria-label="Vertical alignment">
            <button type="button" className="btn-secondary min-h-8 rounded-md text-[10px]" disabled={disabled || cel.locked} onClick={() => applyTransform({ y: halfHeight - dimensions.height / 2 })}>Top</button>
            <button type="button" className="btn-secondary min-h-8 rounded-md text-[10px]" disabled={disabled || cel.locked} onClick={() => applyTransform({ y: 0 })}>Center Y</button>
            <button type="button" className="btn-secondary min-h-8 rounded-md text-[10px]" disabled={disabled || cel.locked} onClick={() => applyTransform({ y: dimensions.height / 2 - halfHeight })}>Bottom</button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1">
            <button type="button" aria-label="Flip frame horizontally" className="btn-secondary flex min-h-8 items-center justify-center rounded-md" disabled={disabled || cel.locked} onClick={() => applyTransform({ flipX: !transform.flipX })}><FlipHorizontal2 size={13} aria-hidden="true" /></button>
            <button type="button" aria-label="Flip frame vertically" className="btn-secondary flex min-h-8 items-center justify-center rounded-md" disabled={disabled || cel.locked} onClick={() => applyTransform({ flipY: !transform.flipY })}><FlipVertical2 size={13} aria-hidden="true" /></button>
            <button type="button" aria-label="Reset frame transform" className="btn-secondary flex min-h-8 items-center justify-center rounded-md" disabled={disabled || cel.locked} onClick={() => editor.reset(cel.id)}><RotateCcw size={13} aria-hidden="true" /></button>
          </div>

          <div className="my-4 border-t border-white/10" />
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold"><Grid3X3 size={14} aria-hidden="true" /> Alignment aids</div>
          <SegmentedControl
            name="Onion skin"
            value={onionMode}
            options={[
              { value: "off", label: "Off" },
              { value: "previous", label: "Prev", disabled: !neighbors.previous },
              { value: "both", label: "Both", disabled: !neighbors.previous && !neighbors.next },
              { value: "next", label: "Next", disabled: !neighbors.next },
            ]}
            onValueChange={setOnionMode}
          />
          <SliderControl
            className="mt-3"
            name="Onion opacity"
            min={5}
            max={80}
            step={1}
            unit="%"
            value={onionOpacity}
            disabled={onionMode === "off"}
            onValueChange={(value) => setOnionOpacity(value)}
          />
          <label className="mt-3 flex min-h-8 items-center gap-2 rounded-md border border-white/10 px-2 text-xs text-textMain">
            <input type="checkbox" checked={guidesEnabled} onChange={(event) => setGuidesEnabled(event.currentTarget.checked)} />
            Center and thirds guides
          </label>
          {feedback ? <p role="alert" className="mt-3 rounded-md border border-red-400/30 bg-red-400/10 p-2 text-xs text-red-100">{feedback}</p> : null}
          <p className="mt-3 text-[10px] leading-relaxed text-textMuted">
            Drag anywhere on the canvas. Hold Alt to bypass snap. Arrow keys move 1 px; Shift moves 10 px.
          </p>
        </aside>
      </div>

      <nav aria-label="Sequence frames" className="custom-scrollbar flex h-24 shrink-0 gap-2 overflow-x-auto border-t border-white/10 bg-panel p-2">
        {sequence.celIds.flatMap((id, index) => {
          const item = project.cels[id];
          if (!item) return [];
          return [(
            <button
              key={id}
              type="button"
              aria-current={id === cel.id ? "true" : undefined}
              disabled={disabled}
              onClick={() => editor.select(sequence.id, id)}
              className={`flex w-20 shrink-0 flex-col items-center justify-center rounded-md border text-xs focus-visible:ring-2 focus-visible:ring-accent ${id === cel.id ? "border-accent bg-accent/15 text-textMain" : "border-white/10 bg-surface text-textMuted hover:text-textMain"}`}
            >
              <span className="font-mono text-base">{String(index + 1).padStart(2, "0")}</span>
              <span className="mt-1 max-w-16 truncate text-[9px]">{item.locked ? "Locked" : `${Math.round(item.durationMs)} ms`}</span>
            </button>
          )];
        })}
      </nav>
    </section>
  );
}

export default AnimateFrameWorkspace;
