import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SourceSessionResource, SourceSessionSnapshot } from "./sourceSession";
import {
  createSourcePreviewUrlLease,
  type SourcePreviewUrlError,
  type SourcePreviewUrlLeaseOptions,
} from "./sourcePreviewUrlLease";

export interface SourcePreviewUrlBinding {
  readonly url: string | null;
  readonly error: SourcePreviewUrlError | null;
  readonly source: SourceSessionResource | null;
  readonly retry: () => void;
}

interface PreviewUrlState {
  readonly source: SourceSessionResource | null;
  readonly url: string | null;
  readonly error: SourcePreviewUrlError | null;
}

const EMPTY_STATE: PreviewUrlState = Object.freeze({ source: null, url: null, error: null });

/**
 * React ownership boundary for a staged source URL. A retained source keeps
 * its lease while a replacement validates; a successful swap/reset/unmount
 * releases the old URL exactly once.
 */
export function useSourcePreviewUrl(
  snapshot: SourceSessionSnapshot,
  getBlob: () => Blob | null,
  options: SourcePreviewUrlLeaseOptions = {},
): SourcePreviewUrlBinding {
  const [state, setState] = useState<PreviewUrlState>(EMPTY_STATE);
  const [retryRevision, setRetryRevision] = useState(0);
  const latestGeneration = useRef(snapshot.generation);
  if (snapshot.generation > latestGeneration.current) {
    latestGeneration.current = snapshot.generation;
  }
  const staleSnapshot = snapshot.generation < latestGeneration.current;
  const source = !snapshot.disposed && !staleSnapshot ? snapshot.source : null;
  const host = options.host;
  const onReleaseError = options.onReleaseError;

  useEffect(() => {
    if (source === null) {
      setState((current) => current === EMPTY_STATE ? current : EMPTY_STATE);
      return;
    }
    let blob: Blob | null;
    try {
      blob = getBlob();
    } catch {
      blob = null;
    }
    if (blob === null) {
      setState(Object.freeze({
        source,
        url: null,
        error: Object.freeze({
          code: "create-failed" as const,
          message: "The source preview URL could not be created.",
        }),
      }));
      return;
    }
    const created = createSourcePreviewUrlLease(blob, { host, onReleaseError });
    if (!created.ok) {
      setState(Object.freeze({ source, url: null, error: created.error }));
      return;
    }
    const lease = created.lease;
    setState(Object.freeze({ source, url: lease.url, error: null }));
    return () => lease.release();
  }, [getBlob, host, onReleaseError, retryRevision, source]);

  const retry = useCallback(() => setRetryRevision((revision) => revision + 1), []);
  const current = state.source === source ? state : EMPTY_STATE;
  return useMemo(() => ({
    url: current.url,
    error: current.error,
    source,
    retry,
  }), [current.error, current.url, retry, source]);
}
