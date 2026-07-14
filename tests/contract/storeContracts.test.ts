import { describe, expect, it } from "vitest";
import {
  STUDIO_STORE_CONTRACTS,
  STUDIO_STORE_KINDS,
  type InteractionState,
  type InteractionStore,
  type JobStore,
  type JobStoreEntry,
  type JobStoreState,
  type PlaybackState,
  type PlaybackStore,
  type ProjectStore,
  type ProjectStoreDispatchResult,
  type ProjectStoreState,
  type WorkspaceState,
  type WorkspaceStore,
} from "../../core/stores";

type Assert<T extends true> = T;
type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2)
    ? (<T>() => T extends TRight ? 1 : 2) extends
        (<T>() => T extends TLeft ? 1 : 2)
      ? true
      : false
    : false;

type StoreApiKey =
  | "kind"
  | "persistence"
  | "history"
  | "getSnapshot"
  | "subscribe"
  | "dispatch";

type _ProjectApiIsExact = Assert<Equal<keyof ProjectStore, StoreApiKey>>;
type _WorkspaceApiIsExact = Assert<Equal<keyof WorkspaceStore, StoreApiKey>>;
type _InteractionApiIsExact = Assert<Equal<keyof InteractionStore, StoreApiKey>>;
type _JobApiIsExact = Assert<Equal<keyof JobStore, StoreApiKey>>;
type _PlaybackApiIsExact = Assert<Equal<keyof PlaybackStore, StoreApiKey>>;
type _ProjectPolicy = Assert<
  Equal<[ProjectStore["persistence"], ProjectStore["history"]], ["durable", "command"]>
>;
type _WorkspacePolicy = Assert<
  Equal<[WorkspaceStore["persistence"], WorkspaceStore["history"]], ["partial", "none"]>
>;
type _InteractionPolicy = Assert<
  Equal<[InteractionStore["persistence"], InteractionStore["history"]], ["ephemeral", "none"]>
>;
type _JobPolicy = Assert<
  Equal<[JobStore["persistence"], JobStore["history"]], ["ephemeral", "none"]>
>;
type _PlaybackPolicy = Assert<
  Equal<[PlaybackStore["persistence"], PlaybackStore["history"]], ["ephemeral", "none"]>
>;
type _WorkspaceHasNoProject = Assert<"project" extends keyof WorkspaceState ? false : true>;
type _InteractionHasNoProject = Assert<"project" extends keyof InteractionState ? false : true>;
type _JobHasNoProject = Assert<"project" extends keyof JobStoreState ? false : true>;
type _PlaybackHasNoProject = Assert<"project" extends keyof PlaybackState ? false : true>;
type _MissingJobIsExplicit = Assert<
  Equal<JobStoreState["jobs"][string], Readonly<JobStoreEntry> | undefined>
>;

void (0 as unknown as _ProjectApiIsExact);
void (0 as unknown as _WorkspaceApiIsExact);
void (0 as unknown as _InteractionApiIsExact);
void (0 as unknown as _JobApiIsExact);
void (0 as unknown as _PlaybackApiIsExact);
void (0 as unknown as _ProjectPolicy);
void (0 as unknown as _WorkspacePolicy);
void (0 as unknown as _InteractionPolicy);
void (0 as unknown as _JobPolicy);
void (0 as unknown as _PlaybackPolicy);
void (0 as unknown as _WorkspaceHasNoProject);
void (0 as unknown as _InteractionHasNoProject);
void (0 as unknown as _JobHasNoProject);
void (0 as unknown as _PlaybackHasNoProject);
void (0 as unknown as _MissingJobIsExplicit);

function compileOnlyBoundaryChecks(
  state: ProjectStoreState,
  dispatchResult: ProjectStoreDispatchResult,
  projectStore: ProjectStore,
  workspaceStore: WorkspaceStore,
  interactionStore: InteractionStore,
  jobStore: JobStore,
  playbackStore: PlaybackStore,
): void {
  // @ts-expect-error Project snapshots are deeply readonly outside dispatch.
  state.project.name = "mutation bypass";
  // @ts-expect-error Dispatch results cannot leak a mutable project reference.
  dispatchResult.result.project.name = "result bypass";
  // @ts-expect-error No store exposes an untracked state replacement escape hatch.
  projectStore.setState(state);
  // @ts-expect-error Partial persistence belongs to an adapter, not the store API.
  workspaceStore.persist();
  // @ts-expect-error Ephemeral stores cannot gain history APIs.
  interactionStore.undo();
  // @ts-expect-error Job state cannot be hydrated into the document boundary.
  jobStore.hydrate({});
  // @ts-expect-error Playback state cannot be serialized by its store.
  playbackStore.serialize();
  // @ts-expect-error ProjectStore only accepts canonical ProjectCommand envelopes.
  projectStore.dispatch({ type: "playback.reset" });
}
void compileOnlyBoundaryChecks;

describe("studio store contracts", () => {
  it("publishes one frozen and exhaustive policy for every store boundary", () => {
    expect(Object.isFrozen(STUDIO_STORE_KINDS)).toBe(true);
    expect(Object.keys(STUDIO_STORE_CONTRACTS)).toEqual(STUDIO_STORE_KINDS);
    expect(STUDIO_STORE_CONTRACTS).toEqual({
      project: { kind: "project", persistence: "durable", history: "command" },
      workspace: { kind: "workspace", persistence: "partial", history: "none" },
      interaction: { kind: "interaction", persistence: "ephemeral", history: "none" },
      job: { kind: "job", persistence: "ephemeral", history: "none" },
      playback: { kind: "playback", persistence: "ephemeral", history: "none" },
    });
    expect(Object.isFrozen(STUDIO_STORE_CONTRACTS)).toBe(true);
    expect(Object.values(STUDIO_STORE_CONTRACTS).every(Object.isFrozen)).toBe(true);
  });

  it("keeps workspace persistence partial without creating document history", () => {
    expect(STUDIO_STORE_CONTRACTS.workspace).toEqual({
      kind: "workspace",
      persistence: "partial",
      history: "none",
    });
    expect(
      ["workspace", "interaction", "job", "playback"].every(
        (kind) =>
          STUDIO_STORE_CONTRACTS[kind as Exclude<keyof typeof STUDIO_STORE_CONTRACTS, "project">]
            .history === "none",
      ),
    ).toBe(true);
  });
});
