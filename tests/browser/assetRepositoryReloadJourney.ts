import {
  IndexedDbAssetRepository,
} from "../../core/assets";
import type {
  AssetMetadata,
  RuntimeObjectUrlHost,
} from "../../core/assets";

const STATE_KEY = "sprite-boy:f2-07:reload-state";

interface JourneyState {
  assetId: string;
  contentHash: string;
  oldUrl: string;
  createdUrls: string[];
  revokedUrls: string[];
  pagehideDisposed: boolean;
}

interface JourneyWindow extends Window {
  __spriteBoyF207Repository?: IndexedDbAssetRepository;
}

function readState(): JourneyState {
  const raw = sessionStorage.getItem(STATE_KEY);
  if (!raw) throw new Error("F2-07 browser journey state is missing.");
  return JSON.parse(raw) as JourneyState;
}

function writeState(state: JourneyState): void {
  sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function instrumentedObjectUrlHost(): RuntimeObjectUrlHost {
  const nativeCreate = URL.createObjectURL.bind(URL);
  const nativeRevoke = URL.revokeObjectURL.bind(URL);
  return {
    createObjectURL(blob) {
      const url = nativeCreate(blob);
      const state = readState();
      state.createdUrls.push(url);
      writeState(state);
      return url;
    },
    revokeObjectURL(url) {
      nativeRevoke(url);
      const state = readState();
      state.revokedUrls.push(url);
      writeState(state);
    },
  };
}

function metadata(assetId: string): AssetMetadata {
  return {
    id: assetId,
    name: "Reload-safe browser asset",
    width: 16,
    height: 16,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    provenance: { source: "f2-07-browser-journey" },
    declaredMimeType: "text/plain",
  };
}

function deleteDatabase(databaseName: string): Promise<"deleted" | "blocked"> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve("deleted");
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve("blocked");
  });
}

async function canFetch(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

/** Stage one: persist bytes and rely on pagehide to close URL/storage lifecycle. */
export async function prepareAssetRepositoryReloadJourney(databaseName: string) {
  const staleCleanup = await deleteDatabase(databaseName);
  if (staleCleanup !== "deleted") throw new Error("Stale F2-07 database cleanup was blocked.");
  const assetId = "asset-reload";
  writeState({
    assetId,
    contentHash: "",
    oldUrl: "",
    createdUrls: [],
    revokedUrls: [],
    pagehideDisposed: false,
  });
  const repository = new IndexedDbAssetRepository("project-reload", {
    databaseName,
    runtimeUrlHost: instrumentedObjectUrlHost(),
  });
  const record = await repository.put(
    new Blob(["persist-across-reload"], { type: "text/plain" }),
    metadata(assetId),
  );
  const oldUrl = await repository.createRuntimeUrl(assetId, {});
  const state = readState();
  state.contentHash = record.contentHash;
  state.oldUrl = oldUrl;
  writeState(state);
  (window as JourneyWindow).__spriteBoyF207Repository = repository;
  window.addEventListener("pagehide", () => {
    repository.dispose();
    const closingState = readState();
    closingState.pagehideDisposed = true;
    writeState(closingState);
    delete (window as JourneyWindow).__spriteBoyF207Repository;
  }, { once: true });
  return {
    assetId,
    contentHash: record.contentHash,
    oldUrlFetchableBeforeReload: await canFetch(oldUrl),
    countsBeforeReload: {
      created: readState().createdUrls.length,
      revoked: readState().revokedUrls.length,
    },
  };
}

/** Stage two: called after a real document reload on the same browser tab. */
export async function resumeAssetRepositoryReloadJourney(databaseName: string) {
  const stateAfterReload = readState();
  const oldUrlFetchableAfterReload = await canFetch(stateAfterReload.oldUrl);
  const repository = new IndexedDbAssetRepository("project-reload", {
    databaseName,
    runtimeUrlHost: instrumentedObjectUrlHost(),
  });
  const record = await repository.getMetadata(stateAfterReload.assetId);
  const blob = await repository.getBlob(stateAfterReload.assetId);
  const scan = await repository.scanIntegrity();
  const firstOwner = {};
  const secondOwner = {};
  const sharedUrlA = await repository.createRuntimeUrl(record.id, firstOwner);
  const sharedUrlB = await repository.createRuntimeUrl(record.id, secondOwner);
  repository.releaseRuntimeUrl(record.id, firstOwner);
  const sharedUrlFetchableAfterFirstRelease = await canFetch(sharedUrlA);
  repository.releaseRuntimeUrl(record.id, secondOwner);
  const sharedUrlFetchableAfterLastRelease = await canFetch(sharedUrlA);
  const finalUrl = await repository.createRuntimeUrl(record.id, {});
  repository.dispose();
  const finalUrlFetchableAfterDispose = await canFetch(finalUrl);
  let disposedOperationCode: string | undefined;
  try {
    await repository.list();
  } catch (error) {
    disposedOperationCode = error instanceof Error && "code" in error
      ? String(error.code)
      : undefined;
  }
  const cleanupResult = await deleteDatabase(databaseName);
  const databaseStillListed = (await indexedDB.databases())
    .some((database) => database.name === databaseName);
  const finalState = readState();
  sessionStorage.removeItem(STATE_KEY);
  return {
    pagehideDisposed: stateAfterReload.pagehideDisposed,
    oldUrlFetchableAfterReload,
    metadata: {
      id: record.id,
      hashMatches: record.contentHash === stateAfterReload.contentHash,
      containsRuntimeUrl: JSON.stringify(record).includes("blob:"),
    },
    blobText: await blob.text(),
    integrity: scan.assets.map(({ assetId, status }) => ({ assetId, status })),
    sharedLease: {
      sameUrl: sharedUrlA === sharedUrlB,
      fetchableAfterFirstRelease: sharedUrlFetchableAfterFirstRelease,
      fetchableAfterLastRelease: sharedUrlFetchableAfterLastRelease,
    },
    dispose: {
      finalUrlWasCreated: finalUrl.startsWith("blob:"),
      finalUrlFetchableAfterDispose,
      laterOperationCode: disposedOperationCode,
    },
    urlBalance: {
      created: finalState.createdUrls.length,
      revoked: finalState.revokedUrls.length,
      balanced: finalState.createdUrls.length === finalState.revokedUrls.length,
      exactIdentityBalance: [...finalState.createdUrls].sort().join("\n")
        === [...finalState.revokedUrls].sort().join("\n"),
      allCreatedUrls: finalState.createdUrls,
      allRevokedUrls: finalState.revokedUrls,
    },
    cleanup: {
      result: cleanupResult,
      databaseStillListed,
    },
  };
}
